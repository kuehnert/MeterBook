import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import sharp, { OutputInfo } from 'sharp';
import { num } from '../common/util';
import { config } from '../config';
import { MetersService } from '../meters/meters.service';
import { PrismaService } from '../prisma.service';
import { ReadingsService, RegisterWarnings } from '../readings/readings.service';
import { OcrResult, OcrService } from './ocr.service';

export interface UploadResult {
  photoId: string;
  takenAt: Date;
  ocr: OcrResult | null;
  ocrError: string | null;
  warnings: RegisterWarnings[];
}

@Injectable()
export class PhotosService {
  private readonly log = new Logger(PhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meters: MetersService,
    private readonly readings: ReadingsService,
    private readonly ocr: OcrService,
  ) {}

  private dir(userId: string) {
    return path.join(config.dataDir, 'photos', userId);
  }

  private file(userId: string, photoId: string, variant: 'full' | 'thumb') {
    return path.join(this.dir(userId), `${photoId}${variant === 'thumb' ? '_thumb' : ''}.jpg`);
  }

  /**
   * Speichert ein Foto (gedreht nach EXIF, verkleinert) und lässt den Stand erkennen.
   * Die Ablesung selbst wird erst gespeichert, wenn der Nutzer die Werte bestätigt.
   */
  async upload(userId: string, meterId: string, buffer: Buffer, takenAtRaw?: string, recognize = true): Promise<UploadResult> {
    const meter = await this.meters.find(userId, meterId);
    const takenAt = takenAtRaw ? new Date(takenAtRaw) : new Date();
    if (Number.isNaN(takenAt.getTime())) throw new BadRequestException('Ungültiges Aufnahmedatum');

    let full: { data: Buffer; info: OutputInfo };
    try {
      full = await sharp(buffer)
        .rotate()
        .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new BadRequestException('Die Datei ist kein lesbares Bild');
    }
    const thumb = await sharp(full.data).resize({ width: 480, height: 480, fit: 'inside' }).jpeg({ quality: 75 }).toBuffer();

    const photo = await this.prisma.photo.create({
      data: { userId, meterId, takenAt, width: full.info.width, height: full.info.height },
    });
    await mkdir(this.dir(userId), { recursive: true });
    await writeFile(this.file(userId, photo.id, 'full'), full.data);
    await writeFile(this.file(userId, photo.id, 'thumb'), thumb);

    let ocr: OcrResult | null = null;
    let ocrError: string | null = null;
    let warnings: RegisterWarnings[] = [];
    if (recognize && this.ocr.enabled) {
      try {
        // Claude verarbeitet Bilder bis ca. 1568 px Kantenlänge ohne Qualitätsverlust.
        const forOcr = await sharp(full.data).resize({ width: 1568, height: 1568, fit: 'inside' }).jpeg({ quality: 90 }).toBuffer();
        const last = await Promise.all(
          meter.registers.map((r) =>
            this.prisma.reading.findFirst({ where: { registerId: r.id, readAt: { lte: takenAt } }, orderBy: { readAt: 'desc' } }),
          ),
        );
        ocr = await this.ocr.read(forOcr, {
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
        });
        await this.prisma.photo.update({
          where: { id: photo.id },
          data: { ocrStatus: 'DONE', ocrResult: JSON.stringify(ocr) },
        });
        const values = ocr.registers.filter((r) => r.value !== null).map((r) => ({ registerId: r.registerId, value: r.value! }));
        if (values.length > 0) {
          warnings = await this.readings.check(userId, meterId, { readAt: takenAt.toISOString(), values });
        }
      } catch (e) {
        ocrError = e instanceof Error ? e.message : String(e);
        this.log.warn(`Erkennung fehlgeschlagen: ${ocrError}`);
        await this.prisma.photo.update({
          where: { id: photo.id },
          data: { ocrStatus: 'FAILED', ocrResult: JSON.stringify({ error: ocrError }) },
        });
      }
    }
    return { photoId: photo.id, takenAt, ocr, ocrError, warnings };
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
    await rm(this.file(userId, photoId, 'full'), { force: true });
    await rm(this.file(userId, photoId, 'thumb'), { force: true });
  }
}
