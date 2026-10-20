// Reine Rechenfunktionen für Verbrauch und Kosten – ohne Datenbank, damit sie sich
// direkt testen lassen. Alle Zeitpunkte sind Millisekunden seit Epoche; Perioden-
// grenzen werden in lokaler Zeit gebildet (Container läuft mit TZ=Europe/Berlin).

export const DAY = 86_400_000;
const AVG_MONTH = (365.2425 / 12) * DAY;
/** Liegen die Ablesungen um einen Grenzpunkt weiter auseinander, gilt der Wert als geschätzt. */
const ESTIMATE_GAP = 45 * DAY;
/** Bis zu diesem Abstand gilt eine Ablesung als „am Stichtag“. */
const SNAP = 3 * DAY;

export interface RawReading {
  readAt: Date;
  value: number;
}

export interface Exchange {
  exchangedAt: Date;
  oldFinalValue: number;
  newInitialValue: number;
}

/** Normierter, durchgehend steigender Zählerstand (Gerätewechsel herausgerechnet). */
export interface Point {
  t: number;
  v: number;
}

export type ValueKind = 'exact' | 'interpolated' | 'extrapolated';

export interface ValueAt {
  v: number;
  kind: ValueKind;
  /** Abstand der beiden umgebenden Ablesungen (0 bei exakt) */
  gap: number;
  /** Abstand zur nächstgelegenen echten Ablesung */
  near: number;
}

export function buildSeries(readings: RawReading[], exchanges: Exchange[]): Point[] {
  const ex = [...exchanges].sort((a, b) => a.exchangedAt.getTime() - b.exchangedAt.getTime());
  const offsetAt = (t: number, inclusive: boolean) => {
    let o = 0;
    for (const e of ex) {
      const et = e.exchangedAt.getTime();
      if (et < t || (inclusive && et === t)) o += e.oldFinalValue - e.newInitialValue;
    }
    return o;
  };
  const points: Point[] = readings.map((r) => {
    const t = r.readAt.getTime();
    return { t, v: r.value + offsetAt(t, true) };
  });
  // Der Endstand des alten Geräts ist selbst eine echte Ablesung.
  for (const e of ex) {
    const t = e.exchangedAt.getTime();
    points.push({ t, v: e.oldFinalValue + offsetAt(t, false) });
  }
  points.sort((a, b) => a.t - b.t);
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.t === p.t) last.v = Math.max(last.v, p.v);
    else out.push({ ...p });
  }
  return out;
}

/** Durchschnittlicher Verbrauch pro Millisekunde über das letzte Jahr (oder was vorhanden ist). */
export function trailingRate(points: Point[], until?: number): number | null {
  const pts = until === undefined ? points : points.filter((p) => p.t <= until);
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  const target = last.t - 365 * DAY;
  let best: Point | null = null;
  for (const p of pts) {
    if (last.t - p.t < 7 * DAY) break;
    if (!best || Math.abs(p.t - target) < Math.abs(best.t - target)) best = p;
  }
  if (!best) best = pts[0];
  if (best.t === last.t) return null;
  return Math.max(0, (last.v - best.v) / (last.t - best.t));
}

export function valueAt(points: Point[], t: number, extrapolate = false): ValueAt | null {
  if (points.length === 0) return null;
  const first = points[0];
  const last = points[points.length - 1];
  // Wenige Stunden/Tage vor der ersten bzw. nach der letzten Ablesung: linear fortschreiben,
  // damit z. B. eine Ablesung am 1.1. um 10 Uhr die Periode ab 1.1. 0 Uhr vollständig abdeckt.
  if (t < first.t) {
    if (first.t - t > SNAP || points.length < 2) return null;
    const rate = (points[1].v - first.v) / (points[1].t - first.t);
    return { v: Math.max(0, first.v - rate * (first.t - t)), kind: 'interpolated', gap: points[1].t - first.t, near: first.t - t };
  }
  if (t > last.t && t - last.t <= SNAP && !extrapolate) {
    const rate = trailingRate(points);
    if (rate === null) return null;
    return { v: last.v + rate * (t - last.t), kind: 'interpolated', gap: Infinity, near: t - last.t };
  }
  if (t > last.t) {
    if (!extrapolate) return null;
    // Saisonal: Verbrauch im gleichen Zeitraum des Vorjahres, sonst Durchschnitt des letzten Jahres.
    const ly = (x: number) => {
      const d = new Date(x);
      return new Date(d.getFullYear() - 1, d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()).getTime();
    };
    const a = valueAt(points, ly(last.t));
    const b = valueAt(points, ly(t));
    if (a && b) return { v: last.v + Math.max(0, b.v - a.v), kind: 'extrapolated', gap: Infinity, near: t - last.t };
    const rate = trailingRate(points);
    if (rate === null) return null;
    return { v: last.v + rate * (t - last.t), kind: 'extrapolated', gap: Infinity, near: t - last.t };
  }
  let lo = 0;
  let hi = points.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t === t) return { v: points[mid].v, kind: 'exact', gap: 0, near: 0 };
    if (points[mid].t < t) lo = mid + 1;
    else hi = mid - 1;
  }
  const a = points[hi];
  const b = points[lo];
  const f = (t - a.t) / (b.t - a.t);
  return { v: a.v + f * (b.v - a.v), kind: 'interpolated', gap: b.t - a.t, near: Math.min(t - a.t, b.t - t) };
}

export interface Consumption {
  value: number;
  /** Mindestens eine Grenze beruht auf weit auseinanderliegenden Ablesungen */
  estimated: boolean;
  /** Ganz oder teilweise in die Zukunft hochgerechnet */
  forecast: boolean;
  /** Intervall nur teilweise durch Ablesungen abgedeckt (Beginn vor erster bzw. Ende nach letzter Ablesung) */
  partial: boolean;
}

export function consumption(
  points: Point[],
  from: number,
  to: number,
  opts: { extrapolate?: boolean } = {},
): Consumption | null {
  if (points.length < 2 || to <= points[0].t - SNAP) return null;
  const last = points[points.length - 1];
  let partial = false;
  let a = from;
  if (a < points[0].t - SNAP) {
    a = points[0].t;
    partial = true;
  }
  let b = to;
  if (b > last.t + SNAP && !opts.extrapolate) {
    if (a >= last.t) return null;
    b = last.t;
    partial = true;
  }
  const va = valueAt(points, a, opts.extrapolate);
  const vb = valueAt(points, b, opts.extrapolate);
  if (!va || !vb) return null;
  const est = (x: ValueAt) => x.kind === 'interpolated' && x.gap > ESTIMATE_GAP && x.near > SNAP;
  return {
    value: Math.max(0, vb.v - va.v),
    estimated: est(va) || est(vb),
    forecast: va.kind === 'extrapolated' || vb.kind === 'extrapolated',
    partial,
  };
}

// ---------------------------------------------------------------------------
// Perioden

export type Granularity = 'day' | 'week' | 'month' | 'year' | 'billing';

export interface BillingStart {
  month: number; // 1–12
  day: number; // 1–28
}

export function bucketStart(t: number, g: Granularity, billing: BillingStart = { month: 1, day: 1 }): number {
  const d = new Date(t);
  switch (g) {
    case 'day':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    case 'week': {
      const dow = (d.getDay() + 6) % 7; // Montag = 0
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow).getTime();
    }
    case 'month':
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    case 'year':
      return new Date(d.getFullYear(), 0, 1).getTime();
    case 'billing': {
      const thisYear = new Date(d.getFullYear(), billing.month - 1, billing.day).getTime();
      return t >= thisYear ? thisYear : new Date(d.getFullYear() - 1, billing.month - 1, billing.day).getTime();
    }
  }
}

export function nextBucket(start: number, g: Granularity): number {
  const d = new Date(start);
  switch (g) {
    case 'day':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    case 'week':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
    case 'month':
      return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    case 'year':
    case 'billing':
      return new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()).getTime();
  }
}

/** Gleiche Periode ein Jahr früher (für Vorjahresvergleich). */
export function sameBucketLastYear(start: number, g: Granularity): number {
  const d = new Date(start);
  if (g === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 364).getTime();
  return new Date(d.getFullYear() - 1, d.getMonth(), d.getDate()).getTime();
}

function isoWeek(t: number): { year: number; week: number } {
  const d = new Date(t);
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / DAY - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: target.getUTCFullYear(), week };
}

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const pad = (n: number) => String(n).padStart(2, '0');

export function bucketLabel(start: number, g: Granularity): string {
  const d = new Date(start);
  switch (g) {
    case 'day':
      return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
    case 'week': {
      const w = isoWeek(start);
      return `KW ${w.week}/${w.year}`;
    }
    case 'month':
      return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    case 'year':
      return String(d.getFullYear());
    case 'billing':
      return d.getMonth() === 0 && d.getDate() === 1
        ? String(d.getFullYear())
        : `${d.getFullYear()}/${pad((d.getFullYear() + 1) % 100)}`;
  }
}

export function buckets(from: number, to: number, g: Granularity, billing?: BillingStart): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let s = bucketStart(from, g, billing);
  while (s < to) {
    const e = nextBucket(s, g);
    out.push({ start: s, end: e });
    s = e;
    if (out.length > 5000) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kosten

export interface TariffInput {
  validFrom: number;
  basePricePerMonth: number;
  /** Summe der Arbeitspreise je Zählwerk (€ pro Einheit) */
  pricePerUnit: Record<string, number>;
}

export interface CostResult {
  energy: number;
  base: number;
  total: number;
  perRegister: Record<string, { consumption: number; cost: number }>;
  /** Für einen Teil des Zeitraums ist kein Tarif hinterlegt */
  missingTariff: boolean;
}

/**
 * Kosten in [from, to). Der Zeitraum wird an Tarifwechseln aufgeteilt; der Verbrauch je
 * Abschnitt kommt aus den (interpolierten) Zählerständen, der Grundpreis zeitanteilig.
 */
export function costs(
  series: Record<string, Point[]>,
  tariffs: TariffInput[],
  from: number,
  to: number,
  opts: { extrapolate?: boolean } = {},
): CostResult {
  const sorted = [...tariffs].sort((a, b) => a.validFrom - b.validFrom);
  const cuts = [from, ...sorted.map((t) => t.validFrom).filter((t) => t > from && t < to), to];
  const res: CostResult = { energy: 0, base: 0, total: 0, perRegister: {}, missingTariff: false };
  for (const reg of Object.keys(series)) res.perRegister[reg] = { consumption: 0, cost: 0 };

  for (let i = 0; i < cuts.length - 1; i++) {
    const s = cuts[i];
    const e = cuts[i + 1];
    const tariff = [...sorted].reverse().find((t) => t.validFrom <= s);
    if (!tariff) res.missingTariff = true;
    for (const [reg, pts] of Object.entries(series)) {
      const c = consumption(pts, s, e, opts);
      if (!c) continue;
      res.perRegister[reg].consumption += c.value;
      if (tariff) {
        const price = tariff.pricePerUnit[reg] ?? 0;
        res.perRegister[reg].cost += c.value * price;
        res.energy += c.value * price;
      }
    }
    if (tariff) res.base += (tariff.basePricePerMonth * (e - s)) / AVG_MONTH;
  }
  res.total = res.energy + res.base;
  return res;
}

export interface AdvanceInput {
  validFrom: number;
  amountPerMonth: number;
}

/** Summe der Abschläge in [from, to), zeitanteilig. */
export function advances(list: AdvanceInput[], from: number, to: number): number {
  const sorted = [...list].sort((a, b) => a.validFrom - b.validFrom);
  let sum = 0;
  for (let i = 0; i < sorted.length; i++) {
    const s = Math.max(from, sorted[i].validFrom);
    const e = Math.min(to, i + 1 < sorted.length ? sorted[i + 1].validFrom : Infinity);
    if (e > s) sum += (sorted[i].amountPerMonth * (e - s)) / AVG_MONTH;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Plausibilität

export interface PlausibilityWarning {
  code: 'DECREASING' | 'HIGH_USAGE' | 'LOW_USAGE' | 'BEFORE_EXCHANGE';
  message: string;
}

export function checkReading(
  points: Point[],
  t: number,
  normalizedValue: number,
  unit: string,
): PlausibilityWarning[] {
  const warnings: PlausibilityWarning[] = [];
  const before = [...points].reverse().find((p) => p.t < t);
  const after = points.find((p) => p.t > t);
  if (before && normalizedValue < before.v - 1e-9) {
    warnings.push({
      code: 'DECREASING',
      message: `Der Wert ist kleiner als die vorige Ablesung (${fmt(before.v)} ${unit}). Zählerstände steigen normalerweise nur an.`,
    });
  }
  if (after && normalizedValue > after.v + 1e-9) {
    warnings.push({
      code: 'DECREASING',
      message: `Der Wert ist größer als die folgende Ablesung (${fmt(after.v)} ${unit}).`,
    });
  }
  const rate = trailingRate(points, before?.t);
  if (before && rate !== null && rate > 0 && t - before.t >= DAY) {
    const expected = rate * (t - before.t);
    const actual = normalizedValue - before.v;
    if (actual > expected * 3 + 1) {
      warnings.push({
        code: 'HIGH_USAGE',
        message: `Ungewöhnlich hoher Verbrauch: ${fmt(actual)} ${unit} seit der letzten Ablesung, erwartet etwa ${fmt(expected)} ${unit}.`,
      });
    } else if (actual >= 0 && expected > 5 && actual < expected * 0.2) {
      warnings.push({
        code: 'LOW_USAGE',
        message: `Ungewöhnlich niedriger Verbrauch: ${fmt(actual)} ${unit} seit der letzten Ablesung, erwartet etwa ${fmt(expected)} ${unit}.`,
      });
    }
  }
  return warnings;
}

function fmt(n: number): string {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}
