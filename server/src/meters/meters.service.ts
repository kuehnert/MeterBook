import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { num, numOr0 } from '../common/util';
import { PrismaService } from '../prisma.service';
import { AdvanceInput, Point, TariffInput, buildSeries } from '../stats/analytics';
import { AdvancePaymentDto, CreateMeterDto, ExchangeDto, TariffDto, UpdateMeterDto } from './dto';

const meterInclude = {
  registers: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.MeterInclude;

type MeterWithRegisters = Prisma.MeterGetPayload<{ include: typeof meterInclude }>;

export interface MeterData {
  meter: MeterWithRegisters;
  series: Record<string, Point[]>;
  tariffs: TariffInput[];
  advances: AdvanceInput[];
}

@Injectable()
export class MetersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, includeArchived = false) {
    const meters = await this.prisma.meter.findMany({
      where: { userId, archived: includeArchived ? undefined : false },
      include: meterInclude,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return Promise.all(meters.map((m) => this.present(m)));
  }

  async get(userId: string, id: string) {
    return this.present(await this.find(userId, id));
  }

  /** Lädt einen Zähler und stellt sicher, dass er dem Nutzer gehört. */
  async find(userId: string, id: string): Promise<MeterWithRegisters> {
    const meter = await this.prisma.meter.findFirst({ where: { id, userId }, include: meterInclude });
    if (!meter) throw new NotFoundException('Zähler nicht gefunden');
    return meter;
  }

  async create(userId: string, dto: CreateMeterDto) {
    const { registers, ...data } = dto;
    const meter = await this.prisma.meter.create({
      data: {
        ...data,
        userId,
        registers: {
          create: registers.map((r, i) => ({ name: r.name, code: r.code, decimals: r.decimals ?? 1, sortOrder: i })),
        },
      },
      include: meterInclude,
    });
    return this.present(meter);
  }

  async update(userId: string, id: string, dto: UpdateMeterDto) {
    const meter = await this.find(userId, id);
    const { registers, ...data } = dto;
    await this.prisma.$transaction(async (tx) => {
      await tx.meter.update({ where: { id }, data });
      if (!registers) return;
      const keep = new Set(registers.filter((r) => r.id).map((r) => r.id!));
      for (const old of meter.registers) {
        if (keep.has(old.id)) continue;
        const count = await tx.reading.count({ where: { registerId: old.id } });
        if (count > 0) {
          throw new BadRequestException(
            `Das Zählwerk „${old.name}“ hat ${count} Ablesungen und kann nicht entfernt werden.`,
          );
        }
        await tx.register.delete({ where: { id: old.id } });
      }
      for (const [i, r] of registers.entries()) {
        const data = { name: r.name, code: r.code ?? null, decimals: r.decimals ?? 1, sortOrder: i };
        if (r.id) {
          if (!meter.registers.some((x) => x.id === r.id)) throw new BadRequestException('Unbekanntes Zählwerk');
          await tx.register.update({ where: { id: r.id }, data });
        } else {
          await tx.register.create({ data: { ...data, meterId: id } });
        }
      }
    });
    return this.get(userId, id);
  }

  async remove(userId: string, id: string) {
    await this.find(userId, id);
    await this.prisma.meter.delete({ where: { id } });
  }

  // --- Tarife ---------------------------------------------------------------

  async listTariffs(userId: string, meterId: string) {
    await this.find(userId, meterId);
    const tariffs = await this.prisma.tariff.findMany({
      where: { meterId },
      include: { components: true },
      orderBy: { validFrom: 'asc' },
    });
    return tariffs.map((t) => ({
      id: t.id,
      name: t.name,
      validFrom: t.validFrom,
      basePricePerMonth: numOr0(t.basePricePerMonth),
      components: t.components.map((c) => ({
        id: c.id,
        registerId: c.registerId,
        label: c.label,
        pricePerUnit: numOr0(c.pricePerUnit),
      })),
    }));
  }

  async saveTariff(userId: string, meterId: string, dto: TariffDto, tariffId?: string) {
    const meter = await this.find(userId, meterId);
    const regIds = new Set(meter.registers.map((r) => r.id));
    if (dto.components.some((c) => !regIds.has(c.registerId))) throw new BadRequestException('Unbekanntes Zählwerk');
    const data = {
      name: dto.name,
      validFrom: new Date(dto.validFrom),
      basePricePerMonth: dto.basePricePerMonth,
    };
    const components = dto.components.map((c) => ({
      registerId: c.registerId,
      label: c.label,
      pricePerUnit: c.pricePerUnit,
    }));
    if (tariffId) {
      await this.findTariff(meterId, tariffId);
      await this.prisma.$transaction([
        this.prisma.tariffComponent.deleteMany({ where: { tariffId } }),
        this.prisma.tariff.update({ where: { id: tariffId }, data: { ...data, components: { create: components } } }),
      ]);
    } else {
      await this.prisma.tariff.create({ data: { ...data, meterId, components: { create: components } } });
    }
    return this.listTariffs(userId, meterId);
  }

  async removeTariff(userId: string, meterId: string, tariffId: string) {
    await this.find(userId, meterId);
    await this.findTariff(meterId, tariffId);
    await this.prisma.tariff.delete({ where: { id: tariffId } });
  }

  private async findTariff(meterId: string, tariffId: string) {
    const t = await this.prisma.tariff.findFirst({ where: { id: tariffId, meterId } });
    if (!t) throw new NotFoundException('Tarif nicht gefunden');
    return t;
  }

  // --- Abschläge ------------------------------------------------------------

  async listAdvances(userId: string, meterId: string) {
    await this.find(userId, meterId);
    const list = await this.prisma.advancePayment.findMany({ where: { meterId }, orderBy: { validFrom: 'asc' } });
    return list.map((a) => ({ id: a.id, validFrom: a.validFrom, amountPerMonth: numOr0(a.amountPerMonth), note: a.note }));
  }

  async saveAdvance(userId: string, meterId: string, dto: AdvancePaymentDto, id?: string) {
    await this.find(userId, meterId);
    const data = { validFrom: new Date(dto.validFrom), amountPerMonth: dto.amountPerMonth, note: dto.note };
    if (id) {
      await this.findAdvance(meterId, id);
      await this.prisma.advancePayment.update({ where: { id }, data });
    } else {
      await this.prisma.advancePayment.create({ data: { ...data, meterId } });
    }
    return this.listAdvances(userId, meterId);
  }

  async removeAdvance(userId: string, meterId: string, id: string) {
    await this.find(userId, meterId);
    await this.findAdvance(meterId, id);
    await this.prisma.advancePayment.delete({ where: { id } });
  }

  private async findAdvance(meterId: string, id: string) {
    const a = await this.prisma.advancePayment.findFirst({ where: { id, meterId } });
    if (!a) throw new NotFoundException('Abschlag nicht gefunden');
    return a;
  }

  // --- Gerätewechsel --------------------------------------------------------

  async listExchanges(userId: string, meterId: string) {
    const meter = await this.find(userId, meterId);
    const list = await this.prisma.meterExchange.findMany({
      where: { registerId: { in: meter.registers.map((r) => r.id) } },
      orderBy: { exchangedAt: 'asc' },
    });
    return list.map((e) => ({
      id: e.id,
      registerId: e.registerId,
      exchangedAt: e.exchangedAt,
      oldFinalValue: numOr0(e.oldFinalValue),
      newInitialValue: numOr0(e.newInitialValue),
      note: e.note,
    }));
  }

  async addExchange(userId: string, meterId: string, dto: ExchangeDto) {
    const meter = await this.find(userId, meterId);
    const regIds = new Set(meter.registers.map((r) => r.id));
    if (dto.values.some((v) => !regIds.has(v.registerId))) throw new BadRequestException('Unbekanntes Zählwerk');
    const exchangedAt = new Date(dto.exchangedAt);
    await this.prisma.$transaction([
      ...dto.values.map((v) =>
        this.prisma.meterExchange.create({
          data: {
            registerId: v.registerId,
            exchangedAt,
            oldFinalValue: v.oldFinalValue,
            newInitialValue: v.newInitialValue,
            note: dto.note,
          },
        }),
      ),
      ...(dto.newSerialNumber
        ? [this.prisma.meter.update({ where: { id: meterId }, data: { serialNumber: dto.newSerialNumber } })]
        : []),
    ]);
    return this.listExchanges(userId, meterId);
  }

  async removeExchange(userId: string, meterId: string, exchangeId: string) {
    const meter = await this.find(userId, meterId);
    const ex = await this.prisma.meterExchange.findFirst({
      where: { id: exchangeId, registerId: { in: meter.registers.map((r) => r.id) } },
    });
    if (!ex) throw new NotFoundException('Gerätewechsel nicht gefunden');
    await this.prisma.meterExchange.delete({ where: { id: exchangeId } });
  }

  // --- Daten für Auswertungen -----------------------------------------------

  async loadData(userId: string, meterId: string): Promise<MeterData> {
    const meter = await this.find(userId, meterId);
    const regIds = meter.registers.map((r) => r.id);
    const [readings, exchanges, tariffs, advances] = await Promise.all([
      this.prisma.reading.findMany({ where: { registerId: { in: regIds } }, orderBy: { readAt: 'asc' } }),
      this.prisma.meterExchange.findMany({ where: { registerId: { in: regIds } } }),
      this.prisma.tariff.findMany({ where: { meterId }, include: { components: true } }),
      this.prisma.advancePayment.findMany({ where: { meterId } }),
    ]);
    const series: Record<string, Point[]> = {};
    for (const r of meter.registers) {
      series[r.id] = buildSeries(
        readings.filter((x) => x.registerId === r.id).map((x) => ({ readAt: x.readAt, value: numOr0(x.value) })),
        exchanges
          .filter((x) => x.registerId === r.id)
          .map((x) => ({
            exchangedAt: x.exchangedAt,
            oldFinalValue: numOr0(x.oldFinalValue),
            newInitialValue: numOr0(x.newInitialValue),
          })),
      );
    }
    return {
      meter,
      series,
      tariffs: tariffs.map((t) => {
        const pricePerUnit: Record<string, number> = {};
        for (const c of t.components) pricePerUnit[c.registerId] = (pricePerUnit[c.registerId] ?? 0) + numOr0(c.pricePerUnit);
        return { validFrom: t.validFrom.getTime(), basePricePerMonth: numOr0(t.basePricePerMonth), pricePerUnit };
      }),
      advances: advances.map((a) => ({ validFrom: a.validFrom.getTime(), amountPerMonth: numOr0(a.amountPerMonth) })),
    };
  }

  /** Summe der Wertkorrekturen durch Gerätewechsel bis zum Zeitpunkt t (inklusive). */
  async exchangeOffset(registerId: string, t: Date): Promise<number> {
    const list = await this.prisma.meterExchange.findMany({ where: { registerId, exchangedAt: { lte: t } } });
    return list.reduce((s, e) => s + numOr0(e.oldFinalValue) - numOr0(e.newInitialValue), 0);
  }

  private async present(m: MeterWithRegisters) {
    const last = await Promise.all(
      m.registers.map((r) =>
        this.prisma.reading.findFirst({ where: { registerId: r.id }, orderBy: { readAt: 'desc' } }),
      ),
    );
    const lastReadAt = last.reduce<Date | null>((acc, r) => (r && (!acc || r.readAt > acc) ? r.readAt : acc), null);
    return {
      id: m.id,
      name: m.name,
      medium: m.medium,
      unit: m.unit,
      serialNumber: m.serialNumber,
      location: m.location,
      notes: m.notes,
      ocrHint: m.ocrHint,
      billingStartMonth: m.billingStartMonth,
      billingStartDay: m.billingStartDay,
      archived: m.archived,
      sortOrder: m.sortOrder,
      lastReadAt,
      registers: m.registers.map((r, i) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        decimals: r.decimals,
        lastReading: last[i] ? { readAt: last[i]!.readAt, value: num(last[i]!.value) } : null,
      })),
    };
  }
}
