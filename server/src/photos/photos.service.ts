import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { Photo } from '@prisma/client';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import sharp from 'sharp';
import { num } from '../common/util';
import { config } from '../config';
import { MetersService } from '../meters/meters.service';
import { PrismaService } from '../prisma.service';
import { ReadingsService, RegisterWarnings } from '../readings/readings.service';
import { Box, boxInCrop, cropFraction, cropPixels } from './crop';
import { OcrMeterInput, OcrResult, OcrService } from './ocr.service';
import { TakenAtSource, resolveTakenAt } from './taken-at';

export interface UploadResult {
  photoId: string;
  /** Zähler, dem das Foto zugeordnet ist (bei automatischer Zuordnung ggf. null) */
  meterId: string | null;
  takenAt: Date;
  /** Woher der Zeitpunkt stammt: EXIF, Dateiname, Angabe der App oder Upload-Zeit */
  takenAtSource: TakenAtSource;
  /** NONE | PENDING (läuft im Hintergrund) | DONE | FAILED */
  ocrStatus: string;
  ocr: OcrResult | null;
  ocrError: string | null;
  warnings: RegisterWarnings[];
}

/** Ein Foto im Eingang: hochgeladen, aber noch keine Ablesung daraus gespeichert. */
export interface InboxItem {
  photoId: string;
  meterId: string | null;
  takenAt: Date;
  createdAt: Date;
  ocrStatus: string;
  ocr: OcrResult | null;
  ocrError: string | null;
  cropped: boolean;
}

/** Gleichzeitig laufende Erkennungen im Hintergrund */
const CONCURRENCY = 2;

type MeterRow = Awaited<ReturnType<MetersService['find']>>;

@Injectable()
export class PhotosService implements OnApplicationBootstrap {
  private readonly log = new Logger(PhotosService.name);
  private readonly queue: string[] = [];
  private running = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly meters: MetersService,
    private readonly readings: ReadingsService,
    private readonly ocr: OcrService,
  ) {}

  /** Erkennungen, die bei einem Neustart unterbrochen wurden, wieder anstoßen. */
  async onApplicationBootstrap() {
    if (process.env.MB_CLI || !this.ocr.enabled) return;
    const pending = await this.prisma.photo.findMany({ where: { ocrStatus: 'PENDING' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    for (const p of pending) this.enqueue(p.id);
    if (pending.length) this.log.log(`${pending.length} unterbrochene Erkennungen werden fortgesetzt`);
  }

  dir(userId: string) {
    return path.join(config.dataDir, 'photos', userId);
  }

  file(userId: string, photoId: string, variant: 'full' | 'thumb') {
    return path.join(this.dir(userId), `${photoId}${variant === 'thumb' ? '_thumb' : ''}.jpg`);
  }

  /**
   * Speichert ein Foto (gedreht nach EXIF, verkleinert) und lässt den Stand erkennen.
   * Ohne meterId bestimmt die Erkennung, welcher Zähler des Nutzers auf dem Foto ist.
   * Die Ablesung selbst wird erst gespeichert, wenn der Nutzer die Werte bestätigt.
   */
  async upload(
    userId: string,
    meterId: string | null,
    buffer: Buffer,
    /** async: Erkennung läuft im Hintergrund, die Antwort kommt sofort (Foto landet im Eingang). */
    opts: { fileName?: string; takenAt?: string; recognize?: boolean; async?: boolean } = {},
  ): Promise<UploadResult> {
    const recognize = opts.recognize ?? true;
    let candidates: MeterRow[];
    if (meterId) {
      candidates = [await this.meters.find(userId, meterId)];
    } else {
      // Im Eingang darf ein Foto auch ohne Erkennung liegen – der Zähler wird dann von Hand gewählt.
      if (!this.ocr.enabled && !opts.async) throw new BadRequestException('Die automatische Zuordnung braucht die Erkennung (ANTHROPIC_API_KEY)');
      const list = await this.meters.list(userId);
      if (list.length === 0) throw new BadRequestException('Noch keine Zähler angelegt');
      candidates = await Promise.all(list.map((m) => this.meters.find(userId, m.id)));
    }

    let full: Buffer;
    let width: number;
    let height: number;
    let exif: Buffer | undefined;
    try {
      // EXIF vor dem Umrechnen lesen – beim Drehen und Verkleinern gehen die Metadaten verloren.
      exif = (await sharp(buffer).metadata()).exif;
      const out = await sharp(buffer)
        .rotate()
        .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
      full = out.data;
      width = out.info.width;
      height = out.info.height;
    } catch {
      throw new BadRequestException('Die Datei ist kein lesbares Bild');
    }
    const { takenAt, source: takenAtSource } = resolveTakenAt({ exif, fileName: opts.fileName, client: opts.takenAt });
    const thumb = await sharp(full).resize({ width: 480, height: 480, fit: 'inside' }).jpeg({ quality: 75 }).toBuffer();

    const background = recognize && this.ocr.enabled && !!opts.async;
    const photo = await this.prisma.photo.create({
      data: {
        userId,
        meterId: meterId || candidates.length === 1 ? candidates[0]?.id ?? null : null,
        takenAt,
        width,
        height,
        ocrStatus: background ? 'PENDING' : 'NONE',
      },
    });
    await mkdir(this.dir(userId), { recursive: true });
    await writeFile(this.file(userId, photo.id, 'full'), full);
    await writeFile(this.file(userId, photo.id, 'thumb'), thumb);

    const base = { photoId: photo.id, meterId: photo.meterId, takenAt, takenAtSource };
    if (background) {
      this.enqueue(photo.id);
      return { ...base, ocrStatus: 'PENDING', ocr: null, ocrError: null, warnings: [] };
    }
    if (!recognize || !this.ocr.enabled) return { ...base, ocrStatus: 'NONE', ocr: null, ocrError: null, warnings: [] };
    return { ...base, ...(await this.recognize(userId, photo.id, full, takenAt, candidates)) };
  }

  /** Ordnet ein Foto einem (anderen) Zähler zu und liest es für diesen Zähler neu. */
  async assign(userId: string, photoId: string, meterId: string): Promise<UploadResult> {
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, userId } });
    if (!photo) throw new NotFoundException('Foto nicht gefunden');
    const meter = await this.meters.find(userId, meterId);
    await this.prisma.photo.update({ where: { id: photoId }, data: { meterId } });
    const base = { photoId, meterId, takenAt: photo.takenAt, takenAtSource: 'client' as TakenAtSource };
    if (!this.ocr.enabled) return { ...base, ocrStatus: 'NONE', ocr: null, ocrError: null, warnings: [] };
    const full = await readFile(this.file(userId, photoId, 'full'));
    return { ...base, ...(await this.recognize(userId, photoId, full, photo.takenAt, [meter])) };
  }

  private async recognize(
    userId: string,
    photoId: string,
    full: Buffer,
    takenAt: Date,
    candidates: MeterRow[],
  ): Promise<Pick<UploadResult, 'meterId' | 'ocrStatus' | 'ocr' | 'ocrError' | 'warnings'>> {
    try {
      // Claude verarbeitet Bilder bis ca. 1568 px Kantenlänge ohne Qualitätsverlust.
      const forOcr = await sharp(full).resize({ width: 1568, height: 1568, fit: 'inside' }).jpeg({ quality: 90 }).toBuffer();
      const inputs: OcrMeterInput[] = await Promise.all(candidates.map((m) => this.ocrInput(m, takenAt)));
      const ocr = await this.ocr.read(forOcr, inputs);
      await this.prisma.photo.update({
        where: { id: photoId },
        data: { ocrStatus: 'DONE', ocrResult: JSON.stringify(ocr), ...(ocr.meterId ? { meterId: ocr.meterId } : {}) },
      });
      let warnings: RegisterWarnings[] = [];
      const values = ocr.registers.filter((r) => r.value !== null).map((r) => ({ registerId: r.registerId, value: r.value! }));
      if (ocr.meterId && values.length > 0) {
        warnings = await this.readings.check(userId, ocr.meterId, { readAt: takenAt.toISOString(), values });
      }
      return { meterId: ocr.meterId, ocrStatus: 'DONE', ocr, ocrError: null, warnings };
    } catch (e) {
      const ocrError = e instanceof Error ? e.message : String(e);
      this.log.warn(`Erkennung fehlgeschlagen: ${ocrError}`);
      await this.prisma.photo.update({
        where: { id: photoId },
        data: { ocrStatus: 'FAILED', ocrResult: JSON.stringify({ error: ocrError }) },
      });
      return { meterId: candidates.length === 1 ? candidates[0].id : null, ocrStatus: 'FAILED', ocr: null, ocrError, warnings: [] };
    }
  }

  // --- Erkennung im Hintergrund ---------------------------------------------

  private enqueue(photoId: string) {
    if (!this.queue.includes(photoId)) this.queue.push(photoId);
    this.pump();
  }

  private pump() {
    while (this.running < CONCURRENCY && this.queue.length > 0) {
      const id = this.queue.shift()!;
      this.running++;
      void this.recognizeStored(id).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async recognizeStored(photoId: string) {
    try {
      const photo = await this.prisma.photo.findUnique({ where: { id: photoId } });
      if (!photo || photo.ocrStatus !== 'PENDING') return;
      const candidates = photo.meterId
        ? [await this.meters.find(photo.userId, photo.meterId)]
        : await Promise.all((await this.meters.list(photo.userId)).map((m) => this.meters.find(photo.userId, m.id)));
      const full = await readFile(this.file(photo.userId, photoId, 'full'));
      await this.recognize(photo.userId, photoId, full, photo.takenAt, candidates);
    } catch (e) {
      this.log.warn(`Erkennung im Hintergrund fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
      await this.prisma.photo
        .update({ where: { id: photoId }, data: { ocrStatus: 'FAILED', ocrResult: JSON.stringify({ error: 'Erkennung fehlgeschlagen' }) } })
        .catch(() => {});
    }
  }

  // --- Eingang ----------------------------------------------------------------

  private toInbox(p: Photo): InboxItem {
    let ocr: OcrResult | null = null;
    let ocrError: string | null = null;
    if (p.ocrResult) {
      const parsed = JSON.parse(p.ocrResult) as OcrResult | { error: string };
      if ('error' in parsed) ocrError = parsed.error;
      else ocr = parsed;
    }
    return { photoId: p.id, meterId: p.meterId, takenAt: p.takenAt, createdAt: p.createdAt, ocrStatus: p.ocrStatus, ocr, ocrError, cropped: p.cropped };
  }

  /** Fotos, aus denen noch keine Ablesung gespeichert wurde – älteste zuerst. */
  async inbox(userId: string): Promise<InboxItem[]> {
    const photos = await this.prisma.photo.findMany({
      where: { userId, readings: { none: {} } },
      orderBy: { createdAt: 'asc' },
    });
    return photos.map((p) => this.toInbox(p));
  }

  async info(userId: string, photoId: string): Promise<InboxItem> {
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, userId } });
    if (!photo) throw new NotFoundException('Foto nicht gefunden');
    return this.toInbox(photo);
  }

  // --- Zuschnitt auf die Ziffern ---------------------------------------------

  /**
   * Schneidet ein Foto auf den Ziffernbereich zu (mit Rand) und verwirft den Rest.
   * false, wenn die Lage der Ziffern unbekannt ist oder schon zugeschnitten wurde.
   */
  async cropToDigits(photoId: string): Promise<boolean> {
    const photo = await this.prisma.photo.findUnique({ where: { id: photoId } });
    if (!photo || photo.cropped || photo.keepFull || photo.ocrStatus !== 'DONE' || !photo.ocrResult) return false;
    const ocr = JSON.parse(photo.ocrResult) as OcrResult;
    const boxes = (ocr.registers ?? []).map((r) => r.box).filter((b): b is Box => !!b);
    let full: Buffer;
    try {
      full = await readFile(this.file(photo.userId, photoId, 'full'));
    } catch {
      return false;
    }
    const meta = await sharp(full).metadata();
    if (!meta.width || !meta.height || !cropFraction(boxes)) return false;
    const rect = cropPixels(boxes, meta.width, meta.height);
    if (!rect) return false;
    const out = await sharp(full).extract(rect).jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
    await this.writeFiles(photo.userId, photoId, out.data);
    const real: Box = [rect.left / meta.width, rect.top / meta.height, rect.width / meta.width, rect.height / meta.height];
    const adjusted: OcrResult = { ...ocr, registers: ocr.registers.map((r) => ({ ...r, box: r.box ? boxInCrop(r.box, real) : null })) };
    await this.prisma.photo.update({
      where: { id: photoId },
      data: { cropped: true, width: out.info.width, height: out.info.height, ocrResult: JSON.stringify(adjusted) },
    });
    return true;
  }

  /** Merkt sich, dass dieses Foto vollständig bleiben soll. */
  async keepFull(photoId: string) {
    await this.prisma.photo.update({ where: { id: photoId }, data: { keepFull: true } });
  }

  /** Alle bestätigten Fotos (mit Ablesung und bekannter Ziffernlage) zuschneiden. */
  async cropAll(): Promise<{ cropped: number; skipped: number }> {
    const photos = await this.prisma.photo.findMany({
      where: { cropped: false, keepFull: false, readings: { some: {} } },
      select: { id: true },
    });
    let cropped = 0;
    for (const p of photos) if (await this.cropToDigits(p.id)) cropped++;
    if (cropped) this.log.log(`${cropped} Fotos auf die Ziffern zugeschnitten`);
    return { cropped, skipped: photos.length - cropped };
  }

  private async ocrInput(meter: MeterRow, takenAt: Date): Promise<OcrMeterInput> {
    const last = await Promise.all(
      meter.registers.map((r) =>
        this.prisma.reading.findFirst({ where: { registerId: r.id, readAt: { lte: takenAt } }, orderBy: { readAt: 'desc' } }),
      ),
    );
    return {
      id: meter.id,
      name: meter.name,
      medium: meter.medium,
      unit: meter.unit,
      serialNumber: meter.serialNumber,
      ocrHint: meter.ocrHint,
      registers: meter.registers.map((r, i) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        decimals: r.decimals,
        lastValue: num(last[i]?.value),
      })),
    };
  }

  async read(userId: string, photoId: string, variant: 'full' | 'thumb'): Promise<Buffer> {
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, userId } });
    if (!photo) throw new NotFoundException('Foto nicht gefunden');
    try {
      return await readFile(this.file(userId, photoId, variant));
    } catch {
      throw new NotFoundException('Fotodatei fehlt');
    }
  }

  async list(userId: string, meterId: string) {
    await this.meters.find(userId, meterId);
    const photos = await this.prisma.photo.findMany({
      where: { meterId },
      orderBy: { takenAt: 'desc' },
      include: { _count: { select: { readings: true } } },
    });
    return photos.map((p) => ({
      id: p.id,
      takenAt: p.takenAt,
      ocrStatus: p.ocrStatus,
      used: p._count.readings > 0,
    }));
  }

  async remove(userId: string, photoId: string) {
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, userId } });
    if (!photo) throw new NotFoundException('Foto nicht gefunden');
    await this.prisma.photo.delete({ where: { id: photoId } });
    await this.removeFiles(userId, photoId);
  }

  async removeFiles(userId: string, photoId: string) {
    await rm(this.file(userId, photoId, 'full'), { force: true });
    await rm(this.file(userId, photoId, 'thumb'), { force: true });
  }

  /** Speichert ein Foto aus einer Sicherung; das Vorschaubild wird neu berechnet. */
  async writeFiles(userId: string, photoId: string, full: Buffer) {
    const thumb = await sharp(full).resize({ width: 480, height: 480, fit: 'inside' }).jpeg({ quality: 75 }).toBuffer();
    await mkdir(this.dir(userId), { recursive: true });
    await writeFile(this.file(userId, photoId, 'full'), full);
    await writeFile(this.file(userId, photoId, 'thumb'), thumb);
  }
}
