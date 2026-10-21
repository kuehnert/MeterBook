import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
    // Warten statt sofortigem Fehler, wenn z. B. die Sicherung per CLI parallel zum Server läuft.
    // Bewusst kein WAL-Modus: Der braucht Shared Memory und ist auf in Docker eingebundenen
    // Windows-Ordnern (Docker Desktop, ./data) unzuverlässig.
    await this.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
  }
}
