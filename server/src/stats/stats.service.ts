import { BadRequestException, Injectable } from '@nestjs/common';
import { round } from '../common/util';
import { MeterData, MetersService } from '../meters/meters.service';
import {
  DAY,
  Granularity,
  advances,
  bucketLabel,
  bucketStart,
  buckets,
  calendarDaysBetween,
  consumption,
  costs,
  nextBucket,
  sameBucketLastYear,
  trailingRate,
} from './analytics';

const GRANULARITIES: Granularity[] = ['day', 'week', 'month', 'year', 'billing'];

export interface RegisterValue {
  value: number | null;
  estimated: boolean;
  partial: boolean;
  forecast: boolean;
}

export interface SeriesBucket {
  start: Date;
  end: Date;
  label: string;
  registers: Record<string, RegisterValue>;
  total: number | null;
  previousYearTotal: number | null;
  cost: number | null;
  perDay: number | null;
  /** Laufende Periode (enthält „jetzt“) */
  current: boolean;
  /** Hochrechnung auf die volle Periode (nur laufende Periode) */
  forecastTotal: number | null;
  forecastCost: number | null;
  /** Farbgruppe 0/1: wechselt mit der übergeordneten Periode (Tage → Woche, Wochen → Monat, Monate → Abrechnungsjahr, sonst jeder Balken) */
  band: number;
  /** Nur Monate: Abrechnungsjahr, zu dem der Monat gehört – „2025“ oder z. B. „2025/26“ bei Heizperioden */
  period: string | null;
}

/** Schlüssel der übergeordneten Periode für den Farbwechsel */
function groupKey(start: number, g: Granularity, index: number, billing: { month: number; day: number }): string | number {
  const d = new Date(start);
  switch (g) {
    case 'day':
      return bucketStart(start, 'week');
    case 'week':
      return `${d.getFullYear()}-${d.getMonth()}`;
    case 'month':
      // Monate gehören zum Abrechnungsjahr (bei 1.1. = Kalenderjahr, sonst z. B. Heizperiode ab 1.8.)
      return bucketStart(start, 'billing', billing);
    default:
      return index;
  }
}

/** Verbrauch über einen zurückliegenden Zeitraum (bis zur letzten Ablesung) */
export interface RecentConsumption {
  /** Kurzname für die Anzeige */
  label: string;
  from: Date;
  to: Date;
  /** Summe aller Zählwerke; null, wenn die Ablesungen den Zeitraum nicht abdecken */
  total: number | null;
  estimated: boolean;
}

const RECENT: Array<{ label: string; back: (d: Date) => Date }> = [
  { label: 'Woche', back: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7, d.getHours(), d.getMinutes()) },
  { label: 'Monat', back: (d) => new Date(d.getFullYear(), d.getMonth() - 1, d.getDate(), d.getHours(), d.getMinutes()) },
  { label: 'Vierteljahr', back: (d) => new Date(d.getFullYear(), d.getMonth() - 3, d.getDate(), d.getHours(), d.getMinutes()) },
  { label: 'Jahr', back: (d) => new Date(d.getFullYear() - 1, d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) },
];

export interface BillingPeriod {
  start: Date;
  end: Date;
  label: string;
  current: boolean;
  registers: Record<string, RegisterValue & { cost: number | null }>;
  total: number | null;
  /** Hochrechnung auf die volle Periode (nur laufende Periode) */
  forecastTotal: number | null;
  cost: { energy: number; base: number; bonus: number; total: number; missingTariff: boolean } | null;
  forecastCost: number | null;
  advances: number;
  forecastAdvances: number | null;
  /** positiv = Nachzahlung, negativ = Guthaben */
  balance: number | null;
}

@Injectable()
export class StatsService {
  constructor(private readonly meters: MetersService) {}

  private range(data: MeterData) {
    let first = Infinity;
    let last = -Infinity;
    for (const pts of Object.values(data.series)) {
      if (pts.length === 0) continue;
      first = Math.min(first, pts[0].t);
      last = Math.max(last, pts[pts.length - 1].t);
    }
    return Number.isFinite(first) ? { first, last } : null;
  }

  private billing(data: MeterData) {
    return { month: data.meter.billingStartMonth, day: data.meter.billingStartDay };
  }

  async series(userId: string, meterId: string, granularity: string, fromRaw?: string, toRaw?: string) {
    if (!GRANULARITIES.includes(granularity as Granularity)) throw new BadRequestException('Unbekannte Einteilung');
    const g = granularity as Granularity;
    const data = await this.meters.loadData(userId, meterId);
    return { meter: { id: data.meter.id, name: data.meter.name, unit: data.meter.unit }, buckets: this.computeSeries(data, g, fromRaw, toRaw) };
  }

  computeSeries(data: MeterData, g: Granularity, fromRaw?: string, toRaw?: string): SeriesBucket[] {
    const range = this.range(data);
    if (!range) return [];
    const defaultSpan: Record<Granularity, number> = {
      day: 60 * DAY,
      week: 365 * DAY,
      month: 3 * 365 * DAY,
      year: 20 * 365 * DAY,
      billing: 20 * 365 * DAY,
    };
    const now = Date.now();
    const to = toRaw ? new Date(toRaw).getTime() : now;
    // Tage: ab Montag der vorletzten Kalenderwoche (zwei volle Wochen + die laufende)
    const defaultFrom =
      g === 'day'
        ? (() => {
            const d = new Date(bucketStart(to, 'week'));
            return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 14).getTime();
          })()
        : to - defaultSpan[g];
    const from = Math.max(range.first, fromRaw ? new Date(fromRaw).getTime() : defaultFrom);
    const billing = this.billing(data);
    const regIds = data.meter.registers.map((r) => r.id);

    let band = 0;
    let prevKey: string | number | null = null;
    return buckets(from, to, g, billing).map(({ start, end }, index) => {
      const key = groupKey(start, g, index, billing);
      if (prevKey !== null && key !== prevKey) band = 1 - band;
      prevKey = key;
      const current = start <= now && now < end;
      let forecastTotal: number | null = null;
      const registers: Record<string, RegisterValue> = {};
      let total: number | null = null;
      let prevTotal: number | null = null;
      const prevStart = sameBucketLastYear(start, g);
      const prevEnd = sameBucketLastYear(end, g);
      for (const id of regIds) {
        const c = consumption(data.series[id], start, end);
        registers[id] = c
          ? { value: round(c.value, 3), estimated: c.estimated, partial: c.partial, forecast: false }
          : { value: null, estimated: false, partial: false, forecast: false };
        if (c) total = (total ?? 0) + c.value;
        const p = consumption(data.series[id], prevStart, prevEnd);
        if (p && !p.partial) prevTotal = (prevTotal ?? 0) + p.value;
        if (current) {
          const f = consumption(data.series[id], start, end, { extrapolate: true });
          if (f) forecastTotal = (forecastTotal ?? 0) + f.value;
        }
      }
      const forecastCost =
        current && data.tariffs.length > 0 && forecastTotal !== null
          ? costs(data.series, data.tariffs, Math.max(start, range.first), end, { extrapolate: true })
          : null;
      const covered = Math.min(end, range.last) - Math.max(start, range.first);
      const cost =
        data.tariffs.length > 0 && total !== null
          ? costs(data.series, data.tariffs, Math.max(start, range.first), Math.min(end, range.last))
          : null;
      return {
        start: new Date(start),
        end: new Date(end),
        label: bucketLabel(start, g),
        registers,
        total: total === null ? null : round(total, 3),
        previousYearTotal: prevTotal === null ? null : round(prevTotal, 3),
        cost: cost && !cost.missingTariff ? round(cost.total, 2) : null,
        perDay: total !== null && covered > 0 ? round(total / (covered / DAY), 3) : null,
        current,
        forecastTotal: forecastTotal === null ? null : round(Math.max(forecastTotal, total ?? 0), 3),
        forecastCost: forecastCost && !forecastCost.missingTariff ? round(forecastCost.total, 2) : null,
        band,
        period: g === 'month' ? bucketLabel(bucketStart(start, 'billing', billing), 'billing') : null,
      };
    });
  }

  async billingPeriods(userId: string, meterId: string) {
    const data = await this.meters.loadData(userId, meterId);
    return { meter: { id: data.meter.id, name: data.meter.name, unit: data.meter.unit }, periods: this.computeBilling(data) };
  }

  computeBilling(data: MeterData): BillingPeriod[] {
    const range = this.range(data);
    if (!range) return [];
    const billing = this.billing(data);
    const now = Date.now();
    const regIds = data.meter.registers.map((r) => r.id);
    const hasTariffs = data.tariffs.length > 0;

    return buckets(range.first, now, 'billing', billing)
      .reverse()
      .map(({ start, end }) => {
        const current = start <= now && now < end;
        const registers: BillingPeriod['registers'] = {};
        let total: number | null = null;
        let forecastTotal: number | null = null;
        const actualCost = hasTariffs ? costs(data.series, data.tariffs, start, Math.min(end, range.last)) : null;
        for (const id of regIds) {
          const c = consumption(data.series[id], start, end);
          const regCost = actualCost?.perRegister[id];
          registers[id] = c
            ? {
                value: round(c.value, 3),
                estimated: c.estimated,
                partial: c.partial,
                forecast: false,
                cost: regCost ? round(regCost.cost, 2) : null,
              }
            : { value: null, estimated: false, partial: false, forecast: false, cost: null };
          if (c) total = (total ?? 0) + c.value;
          if (current) {
            const f = consumption(data.series[id], start, end, { extrapolate: true });
            if (f) forecastTotal = (forecastTotal ?? 0) + f.value;
          }
        }
        const forecastCost =
          current && hasTariffs ? costs(data.series, data.tariffs, start, end, { extrapolate: true }).total : null;
        const adv = advances(data.advances, start, Math.min(end, now));
        const forecastAdvances = current ? advances(data.advances, start, end) : null;
        const balance =
          data.advances.length === 0 || !actualCost
            ? null
            : current
              ? forecastCost !== null && forecastAdvances !== null
                ? round(forecastCost - forecastAdvances, 2)
                : null
              : round(actualCost.total - adv, 2);
        return {
          start: new Date(start),
          end: new Date(end),
          label: bucketLabel(start, 'billing'),
          current,
          registers,
          total: total === null ? null : round(total, 3),
          forecastTotal: forecastTotal === null ? null : round(forecastTotal, 3),
          cost: actualCost
            ? {
                energy: round(actualCost.energy, 2),
                base: round(actualCost.base, 2),
                bonus: round(actualCost.bonus, 2),
                total: round(actualCost.total, 2),
                missingTariff: actualCost.missingTariff,
              }
            : null,
          forecastCost: forecastCost === null ? null : round(forecastCost, 2),
          advances: round(adv, 2),
          forecastAdvances: forecastAdvances === null ? null : round(forecastAdvances, 2),
          balance,
        };
      });
  }

  /** Übersicht für Startseite und App: je Zähler aktueller Stand, laufende Periode, Trend. */
  async overview(userId: string) {
    const list = await this.meters.list(userId);
    const now = Date.now();
    return Promise.all(
      list.map(async (m) => {
        const data = await this.meters.loadData(userId, m.id);
        const periods = this.computeBilling(data);
        const current = periods.find((p) => p.current) ?? null;
        const previous = periods.find((p) => !p.current) ?? null;
        const last30: Record<string, number | null> = {};
        const yearRate: Record<string, number | null> = {};
        for (const r of data.meter.registers) {
          const c = consumption(data.series[r.id], now - 30 * DAY, now);
          last30[r.id] = c ? round(c.value / 30, 3) : null;
          const rate = trailingRate(data.series[r.id]);
          yearRate[r.id] = rate === null ? null : round(rate * DAY, 3);
        }
        const nextBillingStart = nextBucket(bucketStart(now, 'billing', this.billing(data)), 'billing');
        const range = this.range(data);
        // Zeiträume enden bei der letzten Ablesung – danach gibt es keine echten Werte
        const end = range ? Math.min(now, range.last) : null;
        const recentConsumption: RecentConsumption[] =
          end === null
            ? []
            : RECENT.map(({ label, back }) => {
                const from = back(new Date(end)).getTime();
                let total: number | null = 0;
                let estimated = false;
                for (const r of data.meter.registers) {
                  const c = consumption(data.series[r.id], from, end);
                  if (!c || c.partial) {
                    total = null;
                    break;
                  }
                  total += c.value;
                  estimated ||= c.estimated;
                }
                return { label, from: new Date(from), to: new Date(end), total: total === null ? null : round(total, 3), estimated };
              });
        return {
          meter: m,
          recent: await this.meters.recentReadings(data.meter, 2),
          perDayLast30: last30,
          perDayLastYear: yearRate,
          currentPeriod: current,
          previousPeriod: previous,
          nextBillingStart: new Date(nextBillingStart),
          recentConsumption,
          daysSinceLastReading: m.lastReadAt ? calendarDaysBetween(new Date(m.lastReadAt).getTime(), now) : null,
        };
      }),
    );
  }
}
