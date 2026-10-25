import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { config } from '../config';
import { PrismaService } from '../prisma.service';
import { PhotosService } from './photos.service';

const DAY = 86_400_000;

/**
 * Löscht Fotos, die älter als PHOTO_RETENTION_DAYS sind (gemessen am Hochladen). Die Ablesungen
 * bleiben mit Wert und Erkennungsergebnis erhalten, sie verlieren nur den Verweis aufs Foto.
 */
@Injectable()
export class PhotoRetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(PhotoRetentionService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: PhotosService,
  ) {}

  onApplicationBootstrap() {
    if (config.photoRetentionDays <= 0 || process.env.MB_CLI) return;
    // Kurz nach dem Start und danach täglich
    this.timer = setTimeout(() => {
      void this.run();
      this.timer = setInterval(() => void this.run(), DAY);
    }, 60_000);
  }

  onModuleDestroy() {
    clearTimeout(this.timer);
    clearInterval(this.timer);
  }

  /** Stichtag: Fotos, die vor diesem Zeitpunkt hochgeladen wurden, werden gelöscht; null = nie */
  cutoff(now = new Date()): Date | null {
    return config.photoRetentionDays > 0 ? new Date(now.getTime() - config.photoRetentionDays * DAY) : null;
  }

  async run(now = new Date()): Promise<number> {
    const cutoff = this.cutoff(now);
    if (!cutoff) return 0;
    let deleted = 0;
    try {
      const old = await this.prisma.photo.findMany({
        where: {
          OR: [
            { createdAt: { lt: cutoff } },
            // Fotos im Eingang, die keinem Zähler zugeordnet und nie bearbeitet wurden
            { meterId: null, readings: { none: {} }, createdAt: { lt: new Date(now.getTime() - 30 * DAY) } },
          ],
        },
        select: { id: true, userId: true },
      });
      for (const p of old) {
        await this.photos.removeFiles(p.userId, p.id);
        await this.prisma.photo.delete({ where: { id: p.id } });
        deleted++;
      }
      if (deleted > 0) this.log.log(`${deleted} Fotos älter als ${config.photoRetentionDays} Tage gelöscht`);
    } catch (e) {
      this.log.error(`Aufräumen der Fotos fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    }
    return deleted;
  }

  async status() {
    const cutoff = this.cutoff();
    const [total, expiring] = await Promise.all([
      this.prisma.photo.count(),
      cutoff ? this.prisma.photo.count({ where: { createdAt: { lt: cutoff } } }) : Promise.resolve(0),
    ]);
    return { retentionDays: config.photoRetentionDays, total, expiring };
  }
}
