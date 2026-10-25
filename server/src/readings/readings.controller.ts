import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { PhotosService } from '../photos/photos.service';
import { ReadingGroupDto, ReadingsService } from './readings.service';

@Controller('meters/:meterId/readings')
export class ReadingsController {
  constructor(
    private readonly readings: ReadingsService,
    private readonly photos: PhotosService,
  ) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Param('meterId') meterId: string) {
    return this.readings.list(u.id, meterId);
  }

  /** Prüft Werte auf Plausibilität, ohne zu speichern. */
  @Post('check')
  @HttpCode(200)
  check(@CurrentUser() u: AuthUser, @Param('meterId') meterId: string, @Body() dto: ReadingGroupDto) {
    return this.readings.check(u.id, meterId, dto);
  }

  /** Speichert die Ablesung; ein Foto wird danach auf die Ziffern zugeschnitten (außer keepFullPhoto). */
  @Post()
  async save(@CurrentUser() u: AuthUser, @Param('meterId') meterId: string, @Body() dto: ReadingGroupDto) {
    const result = await this.readings.save(u.id, meterId, dto);
    if (dto.photoId && dto.keepFullPhoto) await this.photos.keepFull(dto.photoId);
    const cropped = dto.photoId && !dto.keepFullPhoto ? await this.photos.cropToDigits(dto.photoId).catch(() => false) : false;
    return { ...result, photoCropped: cropped };
  }

  @Delete()
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('meterId') meterId: string, @Query('readAt') readAt: string) {
    return this.readings.removeGroup(u.id, meterId, readAt);
  }
}
