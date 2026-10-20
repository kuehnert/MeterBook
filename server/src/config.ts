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
  admin: {
    email: process.env.ADMIN_EMAIL ?? '',
    password: process.env.ADMIN_PASSWORD ?? '',
    name: process.env.ADMIN_NAME ?? 'Admin',
  },
};
