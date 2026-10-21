// Kommandozeile für Wartungsaufgaben, z. B. im Container:
//
//   docker exec meterbook node dist/cli.js backup                 # Sicherung in BACKUP_DIR ablegen
//   docker exec meterbook node dist/cli.js backup --out /data/x.zip
//   docker exec meterbook node dist/cli.js list                   # vorhandene Sicherungen
//   docker exec meterbook node dist/cli.js restore /data/backups/<datei>.zip --yes
//   docker exec meterbook node dist/cli.js photos-cleanup         # alte Fotos jetzt löschen
//
// Der laufende Server muss dafür nicht angehalten werden.

process.env.MB_CLI = '1'; // keine Zeitpläne, kein Ausliefern des Web-Frontends

import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { AppModule } from './app.module';
import { BackupService } from './backup/backup.service';
import { config } from './config';
import { PhotoRetentionService } from './photos/photo-retention.service';

const USAGE = `Aufruf: node dist/cli.js <befehl>
  backup [--out <datei>]     Sicherung des ganzen Servers (mit Fotos) anlegen
  list                       vorhandene Sicherungen anzeigen
  restore <datei> --yes      ALLE Daten durch die Sicherung ersetzen (vorher wird automatisch gesichert)
  photos-cleanup             Fotos löschen, die älter als PHOTO_RETENTION_DAYS sind`;

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(USAGE);
    return;
  }
  mkdirSync(config.dataDir, { recursive: true });
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const backup = app.get(BackupService);
    switch (cmd) {
      case 'backup': {
        const outIdx = args.indexOf('--out');
        if (outIdx >= 0) {
          const out = path.resolve(args[outIdx + 1] ?? '');
          if (!args[outIdx + 1]) throw new Error('Nach --out fehlt der Dateiname');
          const buf = await backup.serverArchive();
          await writeFile(out, buf);
          console.log(`Sicherung geschrieben: ${out} (${(buf.length / 1_048_576).toFixed(1)} MB)`);
        } else {
          const entry = await backup.create('skript');
          console.log(`Sicherung angelegt: ${path.join(config.backup.dir, entry.name)} (${(entry.size / 1_048_576).toFixed(1)} MB)`);
        }
        break;
      }
      case 'list': {
        const list = await backup.list();
        if (list.length === 0) console.log(`Keine Sicherungen in ${config.backup.dir}`);
        for (const b of list) console.log(`${b.name}\t${(b.size / 1_048_576).toFixed(1)} MB`);
        break;
      }
      case 'restore': {
        const file = args.find((a) => !a.startsWith('--'));
        if (!file) throw new Error('Welche Datei? node dist/cli.js restore <datei> --yes');
        const buf = await readFile(path.resolve(file));
        const info = backup.inspect(buf);
        console.log(`Sicherung vom ${info.createdAt}: ${info.users.length} Nutzer, ${info.photos} Fotos`);
        for (const u of info.users) console.log(`  ${u.email} (${u.role}) – ${u.meters} Zähler, ${u.readings} Ablesungen`);
        if (!args.includes('--yes')) {
          console.log('\nDas ersetzt ALLE Daten auf diesem Server. Zum Ausführen --yes anhängen.');
          process.exitCode = 2;
          break;
        }
        const res = await backup.restore(buf);
        console.log(`Eingespielt: ${res.users} Nutzer. Der vorherige Stand liegt in ${res.safetyBackup}.`);
        console.log('Alle Nutzer müssen sich neu anmelden.');
        break;
      }
      case 'photos-cleanup': {
        const n = await app.get(PhotoRetentionService).run();
        console.log(`${n} Fotos gelöscht`);
        break;
      }
      default:
        console.log(USAGE);
        process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  new Logger('CLI').error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
