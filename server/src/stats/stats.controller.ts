import { Controller, Get, Param, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { StatsService } from './stats.service';

@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('overview')
  overview(@CurrentUser() u: AuthUser) {
    return this.stats.overview(u.id);
  }

  @Get('meters/:id/series')
  series(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Query('granularity') granularity = 'month',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.stats.series(u.id, id, granularity, from, to);
  }

  @Get('meters/:id/billing')
  billing(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.stats.billingPeriods(u.id, id);
  }
}
