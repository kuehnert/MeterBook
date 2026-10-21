import * as path from 'node:path';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Umgebungsvariable ${name} fehlt`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  webDir: process.env.WEB_DIR ? path.resolve(process.env.WEB_DIR) : '',
  jwtSecret: required('JWT_SECRET'),
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlDays: 180,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  ocrModel: process.env.OCR_MODEL || 'claude-opus-5-5',
  /** Name der Umgebung, wird im Web und in der App angezeigt (z. B. "dev"); leer = Produktion */
  envName: process.env.MB_ENV ?? '',
  backup: {
    dir: path.resolve(process.env.BACKUP_DIR ?? path.join(process.env.DATA_DIR ?? './data', 'backups')),
    /** Automatische Sicherung alle n Stunden; 0 = aus */
    intervalHours: Number(process.env.BACKUP_INTERVAL_HOURS ?? 24),
    /** So viele automatische Sicherungen werden aufbewahrt */
    keep: Number(process.env.BACKUP_KEEP ?? 14),
    /** Token für GET /api/backup, z. B. für ein Skript per cron; leer = Endpunkt aus */
    token: process.env.BACKUP_TOKEN ?? '',
  },
  /** Fotos werden nach so vielen Tagen gelöscht (die Ablesungen bleiben); 0 = nie */
  photoRetentionDays: Number(process.env.PHOTO_RETENTION_DAYS ?? 400),
  admin: {
    email: process.env.ADMIN_EMAIL ?? '',
    password: process.env.ADMIN_PASSWORD ?? '',
    name: process.env.ADMIN_NAME ?? 'Admin',
  },
};
