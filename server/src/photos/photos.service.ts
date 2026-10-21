import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import sharp from 'sharp';
import { num } from '../common/util';
import { config } from '../config';
import { MetersService } from '../meters/meters.service';
import { PrismaService } from '../prisma.service';
import { ReadingsService, RegisterWarnings } from '../readings/readings.service';
import { OcrMeterInput, OcrResult, OcrService } from './ocr.service';
import { TakenAtSource, resolveTakenAt } from './taken-at';

export interface UploadResult {
  photoId: string;
  /** Zähler, dem das Foto zugeordnet ist (bei automatischer Zuordnung ggf. null) */
  meterId: string | null;
  takenAt: Date;
  /** Woher der Zeitpunkt stammt: EXIF, Dateiname, Angabe der App oder Upload-Zeit */
  takenAtSource: TakenAtSource;
  ocr: OcrResult | null;
  ocrError: string | null;
  warnings: RegisterWarnings[];
}

type MeterRow = Awaited<ReturnType<MetersService['find']>>;

@Injectable()
export class PhotosService {
  private readonly log = new Logger(PhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meters: MetersService,
    private readonly readings: ReadingsService,
    private readonly ocr: OcrService,
  ) {}

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
    opts: { fileName?: string; takenAt?: string; recognize?: boolean } = {},
  ): Promise<UploadResult> {
    const recognize = opts.recognize ?? true;
    let candidates: MeterRow[];
    if (meterId) {
      candidates = [await this.meters.find(userId, meterId)];
    } else {
      if (!this.ocr.enabled) throw new BadRequestException('Die automatische Zuordnung braucht die Erkennung (ANTHROPIC_API_KEY)');
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

    const photo = await this.prisma.photo.create({
      data: { userId, meterId: candidates.length === 1 ? candidates[0].id : null, takenAt, width, height },
    });
    await mkdir(this.dir(userId), { recursive: true });
    await writeFile(this.file(userId, photo.id, 'full'), full);
    await writeFile(this.file(userId, photo.id, 'thumb'), thumb);

    const base = { photoId: photo.id, meterId: photo.meterId, takenAt, takenAtSource };
    if (!recognize || !this.ocr.enabled) return { ...base, ocr: null, ocrError: null, warnings: [] };
    return { ...base, ...(await this.recognize(userId, photo.id, full, takenAt, candidates)) };
  }

  /** Ordnet ein Foto einem (anderen) Zähler zu und liest es für diesen Zähler neu. */
  async assign(userId: string, photoId: string, meterId: string): Promise<UploadResult> {
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, userId } });
    if (!photo) throw new NotFoundException('Foto nicht gefunden');
    const meter = await this.meters.find(userId, meterId);
    await this.prisma.photo.update({ where: { id: photoId }, data: { meterId } });
    const base = { photoId, meterId, takenAt: photo.takenAt, takenAtSource: 'client' as TakenAtSource };
    if (!this.ocr.enabled) return { ...base, ocr: null, ocrError: null, warnings: [] };
    const full = await readFile(this.file(userId, photoId, 'full'));
    return { ...base, ...(await this.recognize(userId, photoId, full, photo.takenAt, [meter])) };
  }

  private async recognize(
    userId: string,
    photoId: string,
    full: Buffer,
    takenAt: Date,
    candidates: MeterRow[],
  ): Promise<Pick<UploadResult, 'meterId' | 'ocr' | 'ocrError' | 'warnings'>> {
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
      return { meterId: ocr.meterId, ocr, ocrError: null, warnings };
    } catch (e) {
      const ocrError = e instanceof Error ? e.message : String(e);
      this.log.warn(`Erkennung fehlgeschlagen: ${ocrError}`);
      await this.prisma.photo.update({
        where: { id: photoId },
        data: { ocrStatus: 'FAILED', ocrResult: JSON.stringify({ error: ocrError }) },
      });
      return { meterId: candidates.length === 1 ? candidates[0].id : null, ocr: null, ocrError, warnings: [] };
    }
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
