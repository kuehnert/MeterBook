process.env.TZ = 'Europe/Berlin';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextStart, periodStart, readSince } from '../src/reminders/schedule.ts';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

test('wöchentlich: montags 9 Uhr', () => {
  // Mittwoch, 28.10.2026
  assert.deepEqual(periodStart('WEEKLY', local(2026, 10, 28, 15)), local(2026, 10, 26, 9));
  // Montag vor 9 Uhr gehört noch zur Vorwoche
  assert.deepEqual(periodStart('WEEKLY', local(2026, 10, 26, 8, 59)), local(2026, 10, 19, 9));
  assert.deepEqual(periodStart('WEEKLY', local(2026, 10, 26, 9)), local(2026, 10, 26, 9));
  // Sonntag
  assert.deepEqual(periodStart('WEEKLY', local(2026, 11, 1, 20)), local(2026, 10, 26, 9));
  assert.deepEqual(nextStart('WEEKLY', local(2026, 10, 28)), local(2026, 11, 2, 9));
});

test('wöchentlich über die Zeitumstellung', () => {
  // 25.10.2026 endet die Sommerzeit – der Termin bleibt 9 Uhr Ortszeit
  assert.deepEqual(periodStart('WEEKLY', local(2026, 10, 25, 12)), local(2026, 10, 19, 9));
  assert.deepEqual(nextStart('WEEKLY', local(2026, 10, 25, 12)), local(2026, 10, 26, 9));
});

test('monatlich: am 1. um 9 Uhr, auch über den Jahreswechsel', () => {
  assert.deepEqual(periodStart('MONTHLY', local(2026, 10, 15)), local(2026, 10, 1, 9));
  assert.deepEqual(periodStart('MONTHLY', local(2027, 1, 1, 8)), local(2026, 12, 1, 9));
  assert.deepEqual(nextStart('MONTHLY', local(2026, 12, 5)), local(2027, 1, 1, 9));
});

test('aus: kein Termin', () => {
  assert.equal(periodStart('OFF', new Date()), null);
  assert.equal(nextStart('OFF', new Date()), null);
});

test('Ablesungen vom Vortag zählen', () => {
  assert.deepEqual(readSince(local(2026, 10, 26, 9)), local(2026, 10, 25));
  assert.deepEqual(readSince(local(2026, 11, 1, 9)), local(2026, 10, 31));
});

test('vierteljährlich: 1.1., 1.4., 1.7., 1.10. um 9 Uhr', () => {
  assert.deepEqual(periodStart('QUARTERLY', local(2026, 11, 7, 12)), local(2026, 10, 1, 9));
  assert.deepEqual(periodStart('QUARTERLY', local(2026, 10, 1, 8)), local(2026, 7, 1, 9));
  assert.deepEqual(nextStart('QUARTERLY', local(2026, 11, 7)), local(2027, 1, 1, 9));
});

test('jährlich zum Abrechnungsbeginn des Zählers', () => {
  // Heizperiode ab 1.8.
  assert.deepEqual(periodStart('YEARLY', local(2026, 11, 7), { month: 8, day: 1 }), local(2026, 8, 1, 9));
  assert.deepEqual(periodStart('YEARLY', local(2026, 7, 31), { month: 8, day: 1 }), local(2025, 8, 1, 9));
  assert.deepEqual(nextStart('YEARLY', local(2026, 11, 7), { month: 8, day: 1 }), local(2027, 8, 1, 9));
  // ohne Angabe: Kalenderjahr
  assert.deepEqual(periodStart('YEARLY', local(2026, 11, 7)), local(2026, 1, 1, 9));
  assert.equal(periodStart('OFF', local(2026, 11, 7)), null);
});
