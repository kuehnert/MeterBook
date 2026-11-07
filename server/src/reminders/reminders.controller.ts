import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, ValidateIf } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { RemindersService } from './reminders.service';
import { REMINDER_INTERVALS, type ReminderInterval } from './schedule';

class ReminderSettingsDto {
  @IsOptional()
  @IsIn(REMINDER_INTERVALS)
  interval?: ReminderInterval;
  @IsOptional()
  @IsBoolean()
  email?: boolean;
}

class MeterIntervalDto {
  /** null = Standard */
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsIn(REMINDER_INTERVALS)
  interval: ReminderInterval | null;
}

class SkipDto {
  @IsIn(['current', 'next', 'none'])
  which: 'current' | 'next' | 'none';
}

/** Erinnerung ans Ablesen – gilt für E-Mail, App und Web gemeinsam. */
@Controller('me/reminder')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.reminders.state(user.id);
  }

  @Put()
  update(@CurrentUser() user: AuthUser, @Body() dto: ReminderSettingsDto) {
    return this.reminders.update(user.id, dto);
  }

  @Put('meters/:id')
  meter(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MeterIntervalDto) {
    return this.reminders.setMeterInterval(user.id, id, dto.interval ?? null);
  }

  @Post('skip')
  @HttpCode(200)
  skip(@CurrentUser() user: AuthUser, @Body() dto: SkipDto) {
    return this.reminders.skip(user.id, dto.which);
  }
}
