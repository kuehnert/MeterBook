import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AdminOnly, AuthUser, CurrentUser, Public } from '../auth/decorators';
import { sha256 } from '../auth/password';
import { config } from '../config';
import { PrismaService } from '../prisma.service';
import { version } from '../version';
import { PhotoRetentionService } from '../photos/photo-retention.service';
import { BackupService } from './backup.service';

function sendZip(res: Response, name: string, buf: Buffer) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(buf);
}

/** Heutiges Datum in lokaler Zeit (TZ=Europe/Berlin), z. B. 2026-10-21 */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Datenmitnahme: jeder Nutzer exportiert und importiert seine eigenen Daten. */
@Controller('me')
export class TakeoutController {
  constructor(
    private readonly backup: BackupService,
    private readonly prisma: PrismaService,
  ) {}

  /** Dateiname z. B. MeterBook-0.2.0-Daten-Matthias-2026-10-21.zip */
  @Get('export')
  async export(@CurrentUser() u: AuthUser, @Res() res: Response) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    const name = user.name
      .normalize('NFKD')
      .replace(/ß/g, 'ss')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30);
    sendZip(res, `MeterBook-${version}-Daten${name ? `-${name}` : ''}-${today()}.zip`, await this.backup.exportUser(u.id));
  }

  /** ZIP oder JSON aus /me/export. Mit dryRun=true nur prüfen. Vorhandenes wird ergänzt, nie gelöscht. */
  @Post('import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 512 * 1024 * 1024 } }))
  import(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @Query('dryRun') dryRun?: string) {
    if (!file) throw new BadRequestException('Keine Datei übertragen');
    return this.backup.importUser(u.id, file.buffer, dryRun === 'true');
  }
}

/** Server-Sicherung für Administratoren */
@AdminOnly()
@Controller('admin')
export class AdminBackupController {
  constructor(
    private readonly backup: BackupService,
    private readonly retention: PhotoRetentionService,
  ) {}

  @Get('backups')
  async list() {
    return {
      backups: await this.backup.list(),
      dir: config.backup.dir,
      intervalHours: config.backup.intervalHours,
      keep: config.backup.keep,
      tokenConfigured: !!config.backup.token,
      photos: await this.retention.status(),
    };
  }

  @Post('backups')
  create() {
    return this.backup.create('manuell');
  }

  @Get('backups/:name')
  async download(@Param('name') name: string, @Res() res: Response) {
    sendZip(res, name, await this.backup.readStored(name));
  }

  @Delete('backups/:name')
  @HttpCode(204)
  remove(@Param('name') name: string) {
    return this.backup.removeStored(name);
  }

  @Post('backups/:name/restore')
  @HttpCode(200)
  async restoreStored(@Param('name') name: string) {
    return this.backup.restore(await this.backup.readStored(name));
  }

  @Post('restore')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024 * 1024 } }))
  restore(@UploadedFile() file: Express.Multer.File | undefined, @Query('dryRun') dryRun?: string) {
    if (!file) throw new BadRequestException('Keine Datei übertragen');
    // dryRun=true: nur prüfen und den Inhalt zeigen
    return dryRun === 'true' ? this.backup.inspect(file.buffer) : this.backup.restore(file.buffer);
  }

  @Post('photos/cleanup')
  @HttpCode(200)
  async cleanup() {
    return { deleted: await this.retention.run() };
  }
}

/**
 * Sicherung per Skript, z. B. per cron auf dem Host:
 *   curl -fsS -H "Authorization: Bearer $BACKUP_TOKEN" https://…/api/backup -o meterbook.zip
 * Nur aktiv, wenn BACKUP_TOKEN gesetzt ist. Mit ?store=true bleibt eine Kopie in BACKUP_DIR.
 */
@Public()
@Controller('backup')
export class ScriptBackupController {
  constructor(private readonly backup: BackupService) {}

  @Get()
  async get(@Headers('authorization') auth: string | undefined, @Res() res: Response, @Query('store') store?: string) {
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    // Hashes vergleichen: gleiche Länge, keine Rückschlüsse über die Laufzeit
    if (!config.backup.token || !timingSafeEqual(Buffer.from(sha256(token)), Buffer.from(sha256(config.backup.token)))) {
      throw new UnauthorizedException('Ungültiges Sicherungs-Token');
    }
    if (store === 'true') {
      const entry = await this.backup.create('skript');
      sendZip(res, entry.name, await this.backup.readStored(entry.name));
    } else {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
      sendZip(res, `meterbook-${stamp}-skript.zip`, await this.backup.serverArchive());
    }
  }
}
