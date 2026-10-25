// Export und Import von Daten in einem datenbankunabhängigen JSON-Format.
// Wird für die Datenmitnahme einzelner Nutzer und für die Sicherung des ganzen Servers genutzt.
// Fotos, die zu Ablesungen gehören, kommen mit (siehe archive.ts); IDs werden beim Einlesen neu vergeben.

import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

export const EXPORT_FORMAT = 'meterbook-export';
export const BACKUP_FORMAT = 'meterbook-backup';
const VERSION = 1;

type Tx = Prisma.TransactionClient;

/** Foto-Datei, die mit ins Archiv gehört (key = Dateiname im Archiv) */
export interface PhotoRef {
  key: string;
  userId: string;
}

/** Foto-Datei, die nach erfolgreichem Einlesen auf die Platte geschrieben wird */
export interface PendingPhoto {
  userId: string;
  photoId: string;
  data: Buffer;
}

export interface PhotoExport {
  key: string;
  takenAt: string;
  createdAt: string;
  width: number | null;
  height: number | null;
  ocrStatus: string;
  ocrResult: string | null;
}

export interface MeterExport {
  name: string;
  medium: string;
  icon: string | null;
  unit: string;
  serialNumber: string | null;
  location: string | null;
  notes: string | null;
  ocrHint: string | null;
  billingStartMonth: number;
  billingStartDay: number;
  archived: boolean;
  sortOrder: number;
  /** key = Bezug innerhalb der Datei (alte ID) */
  registers: Array<{ key: string; name: string; code: string | null; decimals: number; sortOrder: number }>;
  readings: Array<{
    register: string;
    readAt: string;
    value: string;
    source: string;
    note: string | null;
    ocrValue: string | null;
    ocrConfidence: number | null;
    photo?: string | null;
  }>;
  /** Fotos der Ablesungen; Datei liegt im Archiv unter photos/<key>.jpg */
  photos?: PhotoExport[];
  exchanges: Array<{ register: string; exchangedAt: string; oldFinalValue: string; newInitialValue: string; note: string | null }>;
  tariffs: Array<{ name: string | null; validFrom: string; basePricePerMonth: string; components: Array<{ register: string; label: string; pricePerUnit: string }> }>;
  advances: Array<{ validFrom: string; amountPerMonth: string; note: string | null }>;
}

export interface UserExport {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  user: { email: string; name: string };
  meters: MeterExport[];
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  users: Array<{
    email: string;
    name: string;
    role: string;
    passwordHash: string;
    createdAt: string;
    /** seit 0.3.0 */
    reminderInterval?: string;
    reminderEmail?: boolean;
    meters: MeterExport[];
  }>;
}

export interface ImportSummary {
  metersCreated: number;
  metersMerged: number;
  registersCreated: number;
  readingsCreated: number;
  readingsUpdated: number;
  photosCreated: number;
  exchangesCreated: number;
  tariffsCreated: number;
  advancesCreated: number;
}

class DryRun extends Error {
  constructor(public summary: ImportSummary) {
    super('dry run');
  }
}

const dec = (d: Prisma.Decimal | null) => (d === null ? null : d.toString());

@Injectable()
export class DataTransferService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Export -----------------------------------------------------------------

  private async exportMeters(userId: string, files: PhotoRef[]): Promise<MeterExport[]> {
    const meters = await this.prisma.meter.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        registers: {
          orderBy: { sortOrder: 'asc' },
          include: {
            readings: { orderBy: { readAt: 'asc' }, include: { photo: true } },
            exchanges: { orderBy: { exchangedAt: 'asc' } },
          },
        },
        tariffs: { orderBy: { validFrom: 'asc' }, include: { components: true } },
        advancePayments: { orderBy: { validFrom: 'asc' } },
      },
    });
    return meters.map((m) => {
      const photos = new Map<string, PhotoExport>();
      for (const p of m.registers.flatMap((r) => r.readings.map((x) => x.photo))) {
        if (!p || photos.has(p.id)) continue;
        photos.set(p.id, {
          key: p.id,
          takenAt: p.takenAt.toISOString(),
          createdAt: p.createdAt.toISOString(),
          width: p.width,
          height: p.height,
          ocrStatus: p.ocrStatus,
          ocrResult: p.ocrResult,
        });
        files.push({ key: p.id, userId: p.userId });
      }
      return {
        name: m.name,
        medium: m.medium,
        icon: m.icon,
        unit: m.unit,
        serialNumber: m.serialNumber,
        location: m.location,
        notes: m.notes,
        ocrHint: m.ocrHint,
        billingStartMonth: m.billingStartMonth,
        billingStartDay: m.billingStartDay,
        archived: m.archived,
        sortOrder: m.sortOrder,
        registers: m.registers.map((r) => ({ key: r.id, name: r.name, code: r.code, decimals: r.decimals, sortOrder: r.sortOrder })),
        readings: m.registers.flatMap((r) =>
          r.readings.map((x) => ({
            register: r.id,
            readAt: x.readAt.toISOString(),
            value: x.value.toString(),
            source: x.source,
            note: x.note,
            ocrValue: dec(x.ocrValue),
            ocrConfidence: x.ocrConfidence,
            photo: x.photoId,
          })),
        ),
        photos: [...photos.values()],
        exchanges: m.registers.flatMap((r) =>
          r.exchanges.map((x) => ({
            register: r.id,
            exchangedAt: x.exchangedAt.toISOString(),
            oldFinalValue: x.oldFinalValue.toString(),
            newInitialValue: x.newInitialValue.toString(),
            note: x.note,
          })),
        ),
        tariffs: m.tariffs.map((t) => ({
          name: t.name,
          validFrom: t.validFrom.toISOString(),
          basePricePerMonth: t.basePricePerMonth.toString(),
          components: t.components.map((c) => ({ register: c.registerId, label: c.label, pricePerUnit: c.pricePerUnit.toString() })),
        })),
        advances: m.advancePayments.map((a) => ({ validFrom: a.validFrom.toISOString(), amountPerMonth: a.amountPerMonth.toString(), note: a.note })),
      };
    });
  }

  async exportUser(userId: string): Promise<{ data: UserExport; files: PhotoRef[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const files: PhotoRef[] = [];
    const data: UserExport = {
      format: EXPORT_FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      user: { email: user.email, name: user.name },
      meters: await this.exportMeters(userId, files),
    };
    return { data, files };
  }

  async backup(): Promise<{ data: BackupFile; files: PhotoRef[] }> {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    const files: PhotoRef[] = [];
    const list: BackupFile['users'] = [];
    for (const u of users) {
      list.push({
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: u.passwordHash,
        reminderInterval: u.reminderInterval,
        reminderEmail: u.reminderEmail,
        createdAt: u.createdAt.toISOString(),
        meters: await this.exportMeters(u.id, files),
      });
    }
    return { data: { format: BACKUP_FORMAT, version: VERSION, createdAt: new Date().toISOString(), users: list }, files };
  }

  // --- Import -----------------------------------------------------------------

  /**
   * Führt eine Datenmitnahme in das Konto zusammen: Zähler mit gleichem Namen werden ergänzt,
   * neue angelegt. Ablesungen zum selben Zeitpunkt werden überschrieben, nie verdoppelt.
   * Die Fotodateien in pending schreibt der Aufrufer erst nach erfolgreichem Einlesen.
   */
  async importUser(
    userId: string,
    raw: unknown,
    photos: Map<string, Buffer>,
    dryRun: boolean,
  ): Promise<{ summary: ImportSummary; pending: PendingPhoto[] }> {
    const file = raw as Partial<UserExport> | null;
    if (file && (file as { format?: string }).format === BACKUP_FORMAT) {
      throw new BadRequestException('Das ist eine Server-Sicherung – ein Administrator spielt sie unter Einstellungen ein');
    }
    if (file?.format !== EXPORT_FORMAT || !Array.isArray(file.meters)) {
      throw new BadRequestException('Das ist keine MeterBook-Datenexport-Datei');
    }
    if ((file.version ?? 0) > VERSION) throw new BadRequestException('Die Datei stammt von einer neueren MeterBook-Version');
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const pending: PendingPhoto[] = [];
          const summary = await this.mergeMeters(tx, userId, file.meters!, photos, pending);
          if (dryRun) throw new DryRun(summary);
          return { summary, pending };
        },
        { timeout: 300_000 },
      );
    } catch (e) {
      if (e instanceof DryRun) return { summary: e.summary, pending: [] };
      throw e;
    }
  }

  /** Prüft, ob raw eine Server-Sicherung ist, die eingespielt werden kann. */
  checkBackup(raw: unknown): BackupFile {
    const file = raw as Partial<BackupFile> | null;
    if (file?.format !== BACKUP_FORMAT || !Array.isArray(file.users)) {
      throw new BadRequestException('Das ist keine MeterBook-Server-Sicherung');
    }
    if ((file.version ?? 0) > VERSION) throw new BadRequestException('Die Sicherung stammt von einer neueren MeterBook-Version');
    if (!file.users.some((u) => u.role === 'ADMIN')) throw new BadRequestException('Die Sicherung enthält keinen Administrator');
    return file as BackupFile;
  }

  /** Ersetzt den kompletten Datenbestand des Servers durch eine Sicherung. */
  async restore(raw: unknown, photos: Map<string, Buffer>): Promise<{ users: number; summary: ImportSummary; pending: PendingPhoto[] }> {
    const file = this.checkBackup(raw);
    return this.prisma.$transaction(
      async (tx) => {
        // Alles löschen – Zähler, Ablesungen, Fotos und Anmeldungen hängen per Cascade an den Nutzern.
        await tx.user.deleteMany({});
        const total = emptySummary();
        const pending: PendingPhoto[] = [];
        for (const u of file.users) {
          const user = await tx.user.create({
            data: {
              email: u.email,
              name: u.name,
              role: u.role,
              passwordHash: u.passwordHash,
              createdAt: new Date(u.createdAt),
              reminderInterval: u.reminderInterval ?? 'OFF',
              reminderEmail: u.reminderEmail ?? true,
            },
          });
          add(total, await this.mergeMeters(tx, user.id, u.meters ?? [], photos, pending));
        }
        return { users: file.users.length, summary: total, pending };
      },
      { timeout: 600_000 },
    );
  }

  private async mergeMeters(
    tx: Tx,
    userId: string,
    meters: MeterExport[],
    photoFiles: Map<string, Buffer>,
    pending: PendingPhoto[],
  ): Promise<ImportSummary> {
    const s = emptySummary();
    const existing = await tx.meter.findMany({ where: { userId }, include: { registers: true } });
    for (const m of meters) {
      let meter = existing.find((e) => e.name.trim().toLowerCase() === m.name.trim().toLowerCase());
      if (meter) {
        s.metersMerged++;
      } else {
        const created = await tx.meter.create({
          data: {
            userId,
            name: m.name,
            medium: m.medium,
            icon: m.icon,
            unit: m.unit,
            serialNumber: m.serialNumber,
            location: m.location,
            notes: m.notes,
            ocrHint: m.ocrHint,
            billingStartMonth: m.billingStartMonth,
            billingStartDay: m.billingStartDay,
            archived: m.archived,
            sortOrder: m.sortOrder,
          },
        });
        meter = { ...created, registers: [] };
        existing.push(meter);
        s.metersCreated++;
      }
      const meterId = meter.id;

      // Zählwerke über den Namen zuordnen, fehlende anlegen
      const regMap = new Map<string, string>();
      for (const r of m.registers) {
        let reg = meter.registers.find((x) => x.name.trim().toLowerCase() === r.name.trim().toLowerCase());
        if (!reg) {
          reg = await tx.register.create({ data: { meterId, name: r.name, code: r.code, decimals: r.decimals, sortOrder: r.sortOrder } });
          meter.registers.push(reg);
          s.registersCreated++;
        }
        regMap.set(r.key, reg.id);
      }
      const reg = (key: string) => {
        const id = regMap.get(key);
        if (!id) throw new BadRequestException(`Zähler „${m.name}“: unbekanntes Zählwerk in der Datei`);
        return id;
      };

      // Fotos nur anlegen, wenn die Datei im Archiv liegt; Schlüssel → neue ID
      const photoIds = new Map<string, string>();
      const photoId = async (key: string | null | undefined): Promise<string | null> => {
        if (!key) return null;
        if (photoIds.has(key)) return photoIds.get(key)!;
        const p = m.photos?.find((x) => x.key === key);
        const data = photoFiles.get(key);
        if (!p || !data) return null;
        const created = await tx.photo.create({
          data: {
            userId,
            meterId,
            takenAt: new Date(p.takenAt),
            // Ursprüngliches Datum behalten, damit die Aufbewahrungsfrist weiterläuft
            createdAt: new Date(p.createdAt),
            width: p.width,
            height: p.height,
            ocrStatus: p.ocrStatus,
            ocrResult: p.ocrResult,
          },
        });
        photoIds.set(key, created.id);
        pending.push({ userId, photoId: created.id, data });
        s.photosCreated++;
        return created.id;
      };

      for (const r of m.readings) {
        const registerId = reg(r.register);
        const readAt = new Date(r.readAt);
        const data = { value: r.value, source: r.source, note: r.note, ocrValue: r.ocrValue, ocrConfidence: r.ocrConfidence };
        const found = await tx.reading.findFirst({ where: { registerId, readAt } });
        if (found) {
          const changed = found.value.toString() !== new Prisma.Decimal(r.value).toString();
          const photo = found.photoId ? null : await photoId(r.photo);
          if (changed || photo) {
            await tx.reading.update({ where: { id: found.id }, data: { ...(changed ? data : {}), ...(photo ? { photoId: photo } : {}) } });
            s.readingsUpdated++;
          }
        } else {
          await tx.reading.create({ data: { ...data, registerId, readAt, photoId: await photoId(r.photo) } });
          s.readingsCreated++;
        }
      }
      for (const x of m.exchanges) {
        const registerId = reg(x.register);
        const exchangedAt = new Date(x.exchangedAt);
        if (await tx.meterExchange.findFirst({ where: { registerId, exchangedAt } })) continue;
        await tx.meterExchange.create({ data: { registerId, exchangedAt, oldFinalValue: x.oldFinalValue, newInitialValue: x.newInitialValue, note: x.note } });
        s.exchangesCreated++;
      }
      for (const t of m.tariffs) {
        const validFrom = new Date(t.validFrom);
        if (await tx.tariff.findFirst({ where: { meterId, validFrom } })) continue;
        await tx.tariff.create({
          data: {
            meterId,
            name: t.name,
            validFrom,
            basePricePerMonth: t.basePricePerMonth,
            components: { create: t.components.map((c) => ({ registerId: reg(c.register), label: c.label, pricePerUnit: c.pricePerUnit })) },
          },
        });
        s.tariffsCreated++;
      }
      for (const a of m.advances) {
        const validFrom = new Date(a.validFrom);
        if (await tx.advancePayment.findFirst({ where: { meterId, validFrom } })) continue;
        await tx.advancePayment.create({ data: { meterId, validFrom, amountPerMonth: a.amountPerMonth, note: a.note } });
        s.advancesCreated++;
      }
    }
    return s;
  }
}

function emptySummary(): ImportSummary {
  return {
    metersCreated: 0,
    metersMerged: 0,
    registersCreated: 0,
    readingsCreated: 0,
    readingsUpdated: 0,
    photosCreated: 0,
    exchangesCreated: 0,
    tariffsCreated: 0,
    advancesCreated: 0,
  };
}

function add(a: ImportSummary, b: ImportSummary) {
  for (const k of Object.keys(a) as Array<keyof ImportSummary>) a[k] += b[k];
}
