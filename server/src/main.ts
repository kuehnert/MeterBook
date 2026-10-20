import 'reflect-metadata';
import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync } from 'node:fs';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  mkdirSync(config.dataDir, { recursive: true });
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  // Hinter dem Cloudflare Tunnel kommt die echte Client-IP über X-Forwarded-For.
  app.set('trust proxy', 1);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: (errors) => {
        const messages = errors.flatMap((e) => collect(e));
        return new BadRequestException(messages.length ? messages.join(' · ') : 'Ungültige Eingabe');
      },
    }),
  );
  app.enableShutdownHooks();
  await app.listen(config.port);
  new Logger('MeterBook').log(`Läuft auf Port ${config.port}`);
}

function collect(e: import('class-validator').ValidationError): string[] {
  const own = e.constraints ? Object.values(e.constraints) : [];
  return [...own, ...(e.children ?? []).flatMap(collect)];
}

void bootstrap();
