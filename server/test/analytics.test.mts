import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY,
  advances,
  bucketLabel,
  bucketStart,
  buckets,
  buildSeries,
  checkReading,
  consumption,
  costs,
  valueAt,
} from '../src/stats/analytics.ts';

const d = (s: string) => new Date(s);
const t = (s: string) => new Date(s).getTime();

test('Gerätewechsel wird herausgerechnet', () => {
  const pts = buildSeries(
    [
      { readAt: d('2024-01-01T00:00'), value: 1000 },
      { readAt: d('2024-07-01T00:00'), value: 50 },
    ],
    [{ exchangedAt: d('2024-06-01T00:00'), oldFinalValue: 1500, newInitialValue: 0 }],
  );
  assert.deepEqual(
    pts.map((p) => p.v),
    [1000, 1500, 1550],
  );
});

test('Interpolation und Hochrechnung', () => {
  const pts = buildSeries(
    [
      { readAt: d('2025-01-01T00:00'), value: 0 },
      { readAt: d('2025-01-11T00:00'), value: 100 },
    ],
    [],
  );
  assert.equal(valueAt(pts, t('2025-01-06T00:00'))!.v, 50);
  assert.equal(valueAt(pts, t('2025-01-21T00:00')), null);
  const ex = valueAt(pts, t('2025-01-21T00:00'), true)!;
  assert.equal(ex.kind, 'extrapolated');
  assert.ok(Math.abs(ex.v - 200) < 1e-6);
});

test('Verbrauch über Monatsgrenzen, geschätzt bei großen Lücken', () => {
  const pts = buildSeries(
    [
      { readAt: d('2024-07-01T00:00'), value: 0 },
      { readAt: d('2025-07-01T00:00'), value: 3650 },
    ],
    [],
  );
  const c = consumption(pts, t('2024-08-01T00:00'), t('2024-09-01T00:00'))!;
  assert.ok(Math.abs(c.value - 310) < 0.01);
  assert.equal(c.estimated, true);
  const year = consumption(pts, t('2024-07-01T00:00'), t('2025-07-01T00:00'))!;
  assert.equal(year.value, 3650);
  assert.equal(year.estimated, false);
});

test('Abrechnungsperiode beginnt im Juli', () => {
  const b = { month: 7, day: 1 };
  assert.equal(bucketStart(t('2026-03-15T12:00'), 'billing', b), t('2025-07-01T00:00'));
  assert.equal(bucketStart(t('2026-08-15T12:00'), 'billing', b), t('2026-07-01T00:00'));
  assert.equal(bucketLabel(t('2025-07-01T00:00'), 'billing'), '2025/26');
  assert.equal(bucketLabel(t('2025-01-01T00:00'), 'billing'), '2025');
  assert.equal(buckets(t('2024-08-01T00:00'), t('2026-08-01T00:00'), 'billing', b).length, 3);
  assert.equal(bucketLabel(t('2026-10-19T00:00'), 'week'), 'KW 43/2026');
});

test('Kosten mit Tarifwechsel', () => {
  const pts = buildSeries(
    [
      { readAt: d('2025-01-01T00:00'), value: 0 },
      { readAt: d('2025-12-31T00:00'), value: 364 },
    ],
    [],
  );
  const r = costs(
    { ht: pts },
    [
      { validFrom: t('2025-01-01T00:00'), basePricePerMonth: 10, pricePerUnit: { ht: 0.3 } },
      { validFrom: t('2025-07-02T00:00'), basePricePerMonth: 12, pricePerUnit: { ht: 0.4 } },
    ],
    t('2025-01-01T00:00'),
    t('2025-12-31T00:00'),
  );
  // 182 Tage zu 0,30 €, 182 Tage zu 0,40 € (1 Einheit pro Tag)
  assert.ok(Math.abs(r.energy - (182 * 0.3 + 182 * 0.4)) < 0.01);
  assert.equal(r.missingTariff, false);
  assert.ok(r.base > 130 && r.base < 135);
});

test('Abschläge zeitanteilig', () => {
  const sum = advances([{ validFrom: t('2025-01-01T00:00'), amountPerMonth: 100 }], t('2025-01-01T00:00'), t('2026-01-01T00:00'));
  assert.ok(Math.abs(sum - 1200) < 2);
});

test('Plausibilität: fallender Stand und hoher Verbrauch', () => {
  const pts = buildSeries(
    [
      { readAt: d('2025-01-01T00:00'), value: 0 },
      { readAt: d('2025-02-01T00:00'), value: 31 },
    ],
    [],
  );
  assert.equal(checkReading(pts, t('2025-03-01T00:00'), 20, 'kWh')[0].code, 'DECREASING');
  assert.equal(checkReading(pts, t('2025-03-01T00:00'), 500, 'kWh')[0].code, 'HIGH_USAGE');
  assert.equal(checkReading(pts, t('2025-03-01T00:00'), 31 + 28, 'kWh').length, 0);
  assert.ok(DAY > 0);
});

test('Hochrechnung nutzt den Vorjahresverlauf', () => {
  const pts = buildSeries(
    [
      { readAt: d('2024-07-01T00:00'), value: 0 },
      { readAt: d('2025-01-01T00:00'), value: 3000 }, // Winterhalbjahr
      { readAt: d('2025-07-01T00:00'), value: 3500 },
      { readAt: d('2025-10-01T00:00'), value: 3800 },
    ],
    [],
  );
  // Okt 2025 → Jul 2026 entspricht Okt 2024 → Jul 2025 (interpoliert)
  const v = valueAt(pts, t('2026-07-01T00:00'), true)!;
  const expected = 3800 + (3500 - valueAt(pts, t('2024-10-01T00:00'))!.v);
  assert.equal(v.kind, 'extrapolated');
  assert.ok(Math.abs(v.v - expected) < 1e-6);
});
