import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { AdvancePaymentDto, CreateMeterDto, ExchangeDto, TariffDto, UpdateMeterDto } from './dto';
import { MetersService } from './meters.service';

@Controller('meters')
export class MetersController {
  constructor(private readonly meters: MetersService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('archived') archived?: string) {
    return this.meters.list(u.id, archived === 'true');
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateMeterDto) {
    return this.meters.create(u.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.meters.get(u.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateMeterDto) {
    return this.meters.update(u.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.meters.remove(u.id, id);
  }

  @Get(':id/tariffs')
  tariffs(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.meters.listTariffs(u.id, id);
  }

  @Post(':id/tariffs')
  addTariff(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: TariffDto) {
    return this.meters.saveTariff(u.id, id, dto);
  }

  @Put(':id/tariffs/:tariffId')
  updateTariff(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('tariffId') tariffId: string,
    @Body() dto: TariffDto,
  ) {
    return this.meters.saveTariff(u.id, id, dto, tariffId);
  }

  @Delete(':id/tariffs/:tariffId')
  @HttpCode(204)
  removeTariff(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('tariffId') tariffId: string) {
    return this.meters.removeTariff(u.id, id, tariffId);
  }

  @Get(':id/advances')
  advances(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.meters.listAdvances(u.id, id);
  }

  @Post(':id/advances')
  addAdvance(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: AdvancePaymentDto) {
    return this.meters.saveAdvance(u.id, id, dto);
  }

  @Put(':id/advances/:advanceId')
  updateAdvance(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('advanceId') advanceId: string,
    @Body() dto: AdvancePaymentDto,
  ) {
    return this.meters.saveAdvance(u.id, id, dto, advanceId);
  }

  @Delete(':id/advances/:advanceId')
  @HttpCode(204)
  removeAdvance(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('advanceId') advanceId: string) {
    return this.meters.removeAdvance(u.id, id, advanceId);
  }

  @Get(':id/exchanges')
  exchanges(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.meters.listExchanges(u.id, id);
  }

  @Post(':id/exchanges')
  addExchange(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ExchangeDto) {
    return this.meters.addExchange(u.id, id, dto);
  }

  @Delete(':id/exchanges/:exchangeId')
  @HttpCode(204)
  removeExchange(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('exchangeId') exchangeId: string) {
    return this.meters.removeExchange(u.id, id, exchangeId);
  }
}
