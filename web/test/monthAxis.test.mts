import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthAxisLabels, periodStarts, type MonthSlot } from '../src/lib/monthAxis.ts';

/** 37 Monate ab November 2023, Periode = Kalenderjahr */
const calendar: MonthSlot[] = Array.from({ length: 37 }, (_, k) => {
  const m = (10 + k) % 12;
  return { month: m, period: String(2023 + Math.floor((10 + k) / 12)) };
});
/** dieselben Monate, Heizperiode ab August */
const heating: MonthSlot[] = calendar.map(({ month }, k) => {
  const y = 2023 + Math.floor((10 + k) / 12);
  const start = month >= 7 ? y : y - 1;
  return { month, period: `${start}/${String((start + 1) % 100).padStart(2, '0')}` };
});
const texts = (slots: MonthSlot[], slot: number) => monthAxisLabels(slots, slot).map((l) => l.text);

test('Kalenderjahr: Jahr am Anfang, Dezember am Ende, laufendes Jahr ohne Ende', () => {
  // Über Nov–Dez 2023 passt „Dezember“ nicht neben „2023“
  assert.deepEqual(texts(calendar, 30), ['2023', '2024', 'Dezember', '2025', 'Dezember', '2026']);
});

test('Heizperiode: Periode am Anfang, Juli am Ende', () => {
  assert.deepEqual(texts(heating, 30), ['2023/24', 'Juli', '2024/25', 'Juli', '2025/26', 'Juli', '2026/27']);
  assert.deepEqual(periodStarts(heating), [9, 21, 33]); // jeweils August
});

test('schmal (Handy): Periodennamen haben Vorrang', () => {
  assert.deepEqual(texts(calendar, 8), ['2024', '2025', '2026']);
  assert.deepEqual(texts(heating, 8), ['2023/24', '2024/25', 'Juli', '2025/26', 'Juli']);
  assert.deepEqual(texts(calendar, 5), ['2024', '2025', '2026']);
});

test('Periodenname steht am Anfang der Periode', () => {
  const l = monthAxisLabels(calendar, 30).find((x) => x.text === '2024')!;
  assert.equal(Math.floor(l.at), 2); // Januar 2024 ist Säule 2
  assert.equal(l.anchor, 'start');
  assert.equal(l.strong, true);
});
