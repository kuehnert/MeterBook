import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AuthController } from './auth/auth.controller';
import { AdminBackupController, ScriptBackupController, TakeoutController } from './backup/backup.controller';
import { BackupService } from './backup/backup.service';
import { DataTransferService } from './backup/data-transfer.service';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { config } from './config';
import { HealthController } from './health.controller';
import { MailService } from './mail/mail.service';
import { MetersController } from './meters/meters.controller';
import { MetersService } from './meters/meters.service';
import { OcrService } from './photos/ocr.service';
import { PhotoRetentionService } from './photos/photo-retention.service';
import { PhotosController } from './photos/photos.controller';
import { PhotosService } from './photos/photos.service';
import { PrismaService } from './prisma.service';
import { ReadingsController } from './readings/readings.controller';
import { ReadingsService } from './readings/readings.service';
import { RemindersController } from './reminders/reminders.controller';
import { RemindersService } from './reminders/reminders.service';
import { ReportsController } from './reports/reports.controller';
import { StatsController } from './stats/stats.controller';
import { StatsService } from './stats/stats.service';
import { UsersController } from './users/users.controller';

@Module({
  imports: [
    JwtModule.register({ global: true, secret: config.jwtSecret }),
    ...(config.webDir && !process.env.MB_CLI
      ? [ServeStaticModule.forRoot({ rootPath: config.webDir, exclude: ['/api/{*path}'] })]
      : []),
  ],
  controllers: [
    HealthController,
    AuthController,
    UsersController,
    MetersController,
    ReadingsController,
    PhotosController,
    StatsController,
    ReportsController,
    TakeoutController,
    AdminBackupController,
    ScriptBackupController,
    RemindersController,
  ],
  providers: [
    PrismaService,
    AuthService,
    MetersService,
    ReadingsService,
    OcrService,
    PhotosService,
    StatsService,
    PhotoRetentionService,
    DataTransferService,
    BackupService,
    MailService,
    RemindersService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
