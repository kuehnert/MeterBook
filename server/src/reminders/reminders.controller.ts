import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { RemindersService } from './reminders.service';
import type { ReminderInterval } from './schedule';

class ReminderSettingsDto {
  @IsOptional()
  @IsIn(['OFF', 'WEEKLY', 'MONTHLY'])
  interval?: ReminderInterval;
  @IsOptional()
  @IsBoolean()
  email?: boolean;
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

  @Post('skip')
  @HttpCode(200)
  skip(@CurrentUser() user: AuthUser, @Body() dto: SkipDto) {
    return this.reminders.skip(user.id, dto.which);
  }
}
