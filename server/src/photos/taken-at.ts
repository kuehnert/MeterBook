// Aufnahmezeitpunkt eines Fotos ermitteln: EXIF, dann Dateiname, dann Angabe des Clients, sonst jetzt.
import exifReader from 'exif-reader';

export type TakenAtSource = 'exif' | 'filename' | 'client' | 'now';

const MIN = new Date(2000, 0, 1).getTime();

function plausible(d: Date | null, now: number): d is Date {
  // Kleine Uhrabweichungen der Kamera erlauben, aber keine Zukunft und kein Unsinn.
  return !!d && !Number.isNaN(d.getTime()) && d.getTime() >= MIN && d.getTime() <= now + 10 * 60_000;
}

function local(y: number, mo: number, d: number, h = 12, mi = 0, s = 0): Date | null {
  const date = new Date(y, mo - 1, d, h, mi, s);
  // Ungültige Angaben wie 31.02. fallen hier auf.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || h > 23 || mi > 59 || s > 59) return null;
  return date;
}

/**
 * Datum aus typischen Dateinamen von Handys und Kameras, z. B.
 * IMG_20261020_174912.jpg, PXL_20261020_174912345.jpg, 20261020_174912.jpg,
 * Screenshot_2026-10-20-17-49-12.png, IMG-20261020-WA0007.jpg (nur Datum).
 */
export function dateFromFilename(name: string | undefined): Date | null {
  if (!name) return null;
  const full = name.match(/(?<!\d)(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})[-_ T.]?(\d{2})[-_:.h]?(\d{2})[-_:.m]?(\d{2})/);
  if (full) {
    const [, y, mo, d, h, mi, s] = full.map(Number);
    const r = local(y, mo, d, h, mi, s);
    if (r) return r;
  }
  const day = name.match(/(?<!\d)(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/);
  if (day) {
    const [, y, mo, d] = day.map(Number);
    return local(y, mo, d);
  }
  return null;
}

/** DateTimeOriginal aus den EXIF-Rohdaten (wie sharp sie liefert). */
export function dateFromExif(exif: Buffer | undefined): Date | null {
  if (!exif) return null;
  try {
    const tags = exifReader(exif);
    const raw = tags.Photo?.DateTimeOriginal ?? tags.Photo?.DateTimeDigitized ?? tags.Image?.DateTime;
    if (!(raw instanceof Date) || Number.isNaN(raw.getTime())) return null;
    // exif-reader liest die (zeitzonenlose) Uhrzeit als UTC. Mit Offset-Angabe exakt umrechnen,
    // sonst als lokale Zeit des Servers deuten (TZ=Europe/Berlin).
    const offset = (tags.Photo as Record<string, unknown> | undefined)?.OffsetTimeOriginal;
    if (typeof offset === 'string') {
      const m = offset.match(/^([+-])(\d{2}):(\d{2})$/);
      if (m) {
        const minutes = (Number(m[2]) * 60 + Number(m[3])) * (m[1] === '-' ? -1 : 1);
        return new Date(raw.getTime() - minutes * 60_000);
      }
    }
    return local(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate(), raw.getUTCHours(), raw.getUTCMinutes(), raw.getUTCSeconds());
  } catch {
    return null;
  }
}

export function resolveTakenAt(
  opts: { exif?: Buffer; fileName?: string; client?: string },
  now = Date.now(),
): { takenAt: Date; source: TakenAtSource } {
  const fromExif = dateFromExif(opts.exif);
  if (plausible(fromExif, now)) return { takenAt: fromExif, source: 'exif' };
  const fromName = dateFromFilename(opts.fileName);
  if (plausible(fromName, now)) return { takenAt: fromName, source: 'filename' };
  const fromClient = opts.client ? new Date(opts.client) : null;
  if (plausible(fromClient, now)) return { takenAt: fromClient, source: 'client' };
  return { takenAt: new Date(now), source: 'now' };
}
