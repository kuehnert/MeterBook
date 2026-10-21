import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDateInput, parseDateOnlyInput, parseDecimal } from '../src/lib/parse.ts';

test('Zahlen: Punkt und Komma zusammen – das letzte trennt die Nachkommastellen', () => {
  assert.equal(parseDecimal('79,820.00'), 79820);
  assert.equal(parseDecimal('79.820,00'), 79820);
  assert.equal(parseDecimal('1,234,567.89'), 1234567.89);
  assert.equal(parseDecimal('1.234.567,89', 'en'), 1234567.89);
});

test('Zahlen: ein Trennzeichen ohne drei Ziffern dahinter ist das Dezimalzeichen', () => {
  assert.equal(parseDecimal('79,8'), 79.8);
  assert.equal(parseDecimal('79.8'), 79.8);
  assert.equal(parseDecimal('29789,62'), 29789.62);
  assert.equal(parseDecimal('29789.62', 'de'), 29789.62);
  assert.equal(parseDecimal('0,0425'), 0.0425);
  assert.equal(parseDecimal('5,'), 5);
});

test('Zahlen: mehrdeutige Fälle entscheidet das Format', () => {
  assert.equal(parseDecimal('79,820', 'de'), 79.82);
  assert.equal(parseDecimal('79,820', 'en'), 79820);
  assert.equal(parseDecimal('79.820', 'de'), 79820);
  assert.equal(parseDecimal('79.820', 'en'), 79.82);
});

test('Zahlen: mehrere gleiche Trennzeichen sind Tausender', () => {
  assert.equal(parseDecimal('1.234.567'), 1234567);
  assert.equal(parseDecimal('1,234,567'), 1234567);
  assert.equal(parseDecimal('1 234,5'), 1234.5);
  assert.equal(parseDecimal('1 234,5'), 1234.5);
});

test('Zahlen: Einheiten, Währung und Vorzeichen', () => {
  assert.equal(parseDecimal('79.820,0 kWh'), 79820);
  assert.equal(parseDecimal('401,25 m³'), 401.25);
  assert.equal(parseDecimal('€ 12,50'), 12.5);
  assert.equal(parseDecimal('-3,5'), -3.5);
});

test('Zahlen: Unsinn ergibt null', () => {
  assert.equal(parseDecimal(''), null);
  assert.equal(parseDecimal('abc'), null);
  assert.equal(parseDecimal('12.34.56'), null);
  assert.equal(parseDecimal('1,2,3.4.5'), null);
  assert.equal(parseDecimal('12,34.5'), null);
});

test('Datum: deutsches Format, ohne Uhrzeit gilt 10:00', () => {
  assert.equal(parseDateInput('02.08.2025'), '2025-08-02 10:00:00');
  assert.equal(parseDateInput('2.8.2025'), '2025-08-02 10:00:00');
  assert.equal(parseDateInput('2.8.25'), '2025-08-02 10:00:00');
  assert.equal(parseDateInput(' 02/08/2025 '), '2025-08-02 10:00:00');
});

test('Datum: mit Uhrzeit', () => {
  assert.equal(parseDateInput('02.08.2025 14:30'), '2025-08-02 14:30:00');
  assert.equal(parseDateInput('02.08.2025, 7:05'), '2025-08-02 07:05:00');
  assert.equal(parseDateInput('02.08.2025 14.30 Uhr'), '2025-08-02 14:30:00');
  assert.equal(parseDateInput('2025-08-02T14:30:15'), '2025-08-02 14:30:15');
  assert.equal(parseDateInput('2025-08-02'), '2025-08-02 10:00:00');
});

test('Datum: ungültig oder unvollständig', () => {
  assert.equal(parseDateInput('31.02.2025'), null);
  assert.equal(parseDateInput('02.08.202'), null);
  assert.equal(parseDateInput('02.08.2025 14:3'), null);
  assert.equal(parseDateInput('02.08.2025 25:00'), null);
  assert.equal(parseDateInput('02.08.'), null);
  assert.equal(parseDateInput('gestern'), null);
});

test('Nur Datum', () => {
  assert.equal(parseDateOnlyInput('01.07.2026'), '2026-07-01');
  assert.equal(parseDateOnlyInput('1.7.26'), '2026-07-01');
});
