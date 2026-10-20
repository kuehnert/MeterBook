import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { config } from './config';
import { HealthController } from './health.controller';
import { MetersController } from './meters/meters.controller';
import { MetersService } from './meters/meters.service';
import { OcrService } from './photos/ocr.service';
import { PhotosController } from './photos/photos.controller';
import { PhotosService } from './photos/photos.service';
import { PrismaService } from './prisma.service';
import { ReadingsController } from './readings/readings.controller';
import { ReadingsService } from './readings/readings.service';
import { ReportsController } from './reports/reports.controller';
import { StatsController } from './stats/stats.controller';
import { StatsService } from './stats/stats.service';
import { UsersController } from './users/users.controller';

@Module({
  imports: [
    JwtModule.register({ global: true, secret: config.jwtSecret }),
    ...(config.webDir
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
  ],
  providers: [
    PrismaService,
    AuthService,
    MetersService,
    ReadingsService,
    OcrService,
    PhotosService,
    StatsService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
