import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { config } from '../config';
import { PhotosService } from '../photos/photos.service';
import { buildArchive, readArchive } from './archive';
import { DataTransferService, ImportSummary, PendingPhoto, PhotoRef } from './data-transfer.service';

export type BackupKind = 'auto' | 'manuell' | 'skript' | 'vor-wiederherstellung';

export interface BackupEntry {
  name: string;
  size: number;
  createdAt: Date;
  kind: string;
}

const NAME = /^meterbook-(\d{8}-\d{6})-([a-z-]+)\.zip$/;
const HOUR = 3_600_000;

/**
 * Sicherungen des ganzen Servers (ZIP mit Daten und Fotos) und Datenmitnahme einzelner Nutzer.
 * Legt außerdem regelmäßig automatische Sicherungen im Ordner BACKUP_DIR an.
 */
@Injectable()
export class BackupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(BackupService.name);
  private timer?: NodeJS.Timeout;
  private restoring = false;

  constructor(
    private readonly transfer: DataTransferService,
    private readonly photos: PhotosService,
  ) {}

  onApplicationBootstrap() {
    if (config.backup.intervalHours <= 0 || process.env.MB_CLI) return;
    // Stündlich prüfen, ob die letzte automatische Sicherung älter als das Intervall ist
    const check = () => void this.autoBackup();
    this.timer = setInterval(check, HOUR);
    setTimeout(check, 2 * 60_000).unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async autoBackup() {
    try {
      const last = (await this.list()).find((b) => b.kind === 'auto');
      if (last && Date.now() - last.createdAt.getTime() < config.backup.intervalHours * HOUR - 5 * 60_000) return;
      await this.create('auto');
    } catch (e) {
      this.log.error(`Automatische Sicherung fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async loadPhotos(refs: PhotoRef[]): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>();
    for (const r of refs) {
      try {
        out.set(r.key, await readFile(this.photos.file(r.userId, r.key, 'full')));
      } catch {
        // Datei fehlt (z. B. von Hand gelöscht) – die Ablesung kommt trotzdem mit
      }
    }
    return out;
  }

  private async writePending(pending: PendingPhoto[]) {
    for (const p of pending) {
      try {
        await this.photos.writeFiles(p.userId, p.photoId, p.data);
      } catch (e) {
        this.log.warn(`Foto ${p.photoId} konnte nicht geschrieben werden: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  private read(file: Buffer) {
    try {
      return readArchive(file);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Datei nicht lesbar');
    }
  }

  // --- Datenmitnahme eines Nutzers ------------------------------------------------

  async exportUser(userId: string): Promise<Buffer> {
    const { data, files } = await this.transfer.exportUser(userId);
    return buildArchive(data, await this.loadPhotos(files));
  }

  async importUser(userId: string, file: Buffer, dryRun: boolean): Promise<ImportSummary> {
    const { data, photos } = this.read(file);
    const { summary, pending } = await this.transfer.importUser(userId, data, photos, dryRun);
    await this.writePending(pending);
    return summary;
  }

  // --- Server-Sicherung ------------------------------------------------------------

  async serverArchive(): Promise<Buffer> {
    const { data, files } = await this.transfer.backup();
    return buildArchive(data, await this.loadPhotos(files));
  }

  /** Schreibt eine Sicherung nach BACKUP_DIR und räumt alte automatische Sicherungen auf. */
  async create(kind: BackupKind): Promise<BackupEntry> {
    const buf = await this.serverArchive();
    await mkdir(config.backup.dir, { recursive: true });
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
    const name = `meterbook-${stamp}-${kind}.zip`;
    await writeFile(path.join(config.backup.dir, name), buf);
    this.log.log(`Sicherung ${name} geschrieben (${(buf.length / 1_048_576).toFixed(1)} MB)`);
    if (kind === 'auto') {
      // Nur automatische Sicherungen werden aufgeräumt; alle anderen bleiben, bis man sie löscht.
      const old = (await this.list()).filter((b) => b.kind === 'auto').slice(Math.max(1, config.backup.keep));
      for (const b of old) await rm(path.join(config.backup.dir, b.name), { force: true });
    }
    return { name, size: buf.length, createdAt: now, kind };
  }

  /** Sicherungen in BACKUP_DIR, neueste zuerst */
  async list(): Promise<BackupEntry[]> {
    let names: string[];
    try {
      names = await readdir(config.backup.dir);
    } catch {
      return [];
    }
    const out: BackupEntry[] = [];
    for (const name of names) {
      const m = name.match(NAME);
      if (!m) continue;
      const s = await stat(path.join(config.backup.dir, name));
      out.push({ name, size: s.size, createdAt: s.mtime, kind: m[2] });
    }
    return out.sort((a, b) => b.name.localeCompare(a.name));
  }

  async readStored(name: string): Promise<Buffer> {
    if (!NAME.test(name)) throw new NotFoundException('Sicherung nicht gefunden');
    try {
      return await readFile(path.join(config.backup.dir, name));
    } catch {
      throw new NotFoundException('Sicherung nicht gefunden');
    }
  }

  async removeStored(name: string) {
    if (!NAME.test(name)) throw new NotFoundException('Sicherung nicht gefunden');
    await rm(path.join(config.backup.dir, name), { force: true });
  }

  /** Prüft eine Sicherung, ohne etwas zu ändern – für die Rückfrage vor dem Einspielen. */
  inspect(file: Buffer) {
    const { data, photos } = this.read(file);
    const backup = this.transfer.checkBackup(data);
    return {
      createdAt: backup.createdAt,
      photos: photos.size,
      users: backup.users.map((u) => ({
        email: u.email,
        name: u.name,
        role: u.role,
        meters: u.meters.length,
        readings: u.meters.reduce((s, m) => s + m.readings.length, 0),
      })),
    };
  }

  /**
   * Ersetzt alle Daten des Servers durch die Sicherung. Vorher wird der aktuelle Stand als
   * "vor-wiederherstellung" gesichert, damit nichts verloren geht.
   */
  async restore(file: Buffer) {
    const { data, photos } = this.read(file);
    this.transfer.checkBackup(data);
    if (this.restoring) throw new ConflictException('Es läuft schon eine Wiederherstellung');
    this.restoring = true;
    try {
      const safety = await this.create('vor-wiederherstellung');
      const result = await this.transfer.restore(data, photos);
      // Die alten Fotoordner gehören zu Nutzer-IDs, die es nicht mehr gibt
      await rm(path.join(config.dataDir, 'photos'), { recursive: true, force: true });
      await this.writePending(result.pending);
      this.log.warn(`Sicherung eingespielt: ${result.users} Nutzer, ${result.summary.readingsCreated} Ablesungen`);
      return { users: result.users, summary: result.summary, safetyBackup: safety.name };
    } finally {
      this.restoring = false;
    }
  }
}
