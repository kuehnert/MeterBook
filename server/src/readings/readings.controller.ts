import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { ReadingGroupDto, ReadingsService } from './readings.service';

@Controller('meters/:meterId/readings')
export class ReadingsController {
  constructor(private readonly readings: ReadingsService) {}

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

  @Post()
  save(@CurrentUser() u: AuthUser, @Param('meterId') meterId: string, @Body() dto: ReadingGroupDto) {
    return this.readings.save(u.id, meterId, dto);
  }

  @Delete()
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('meterId') meterId: string, @Query('readAt') readAt: string) {
    return this.readings.removeGroup(u.id, meterId, readAt);
  }
}
