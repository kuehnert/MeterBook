import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDecimal } from '../src/common/parse-number.ts';

const parseNumber = (s: string) => parseDecimal(s, 'de'); // wie reports/import.ts

test('Import: Zahlen in deutscher und englischer Schreibweise', () => {
  assert.equal(parseNumber('29789,6'), 29789.6);
  assert.equal(parseNumber('29.789,6'), 29789.6);
  assert.equal(parseNumber('29789.6'), 29789.6);
  assert.equal(parseNumber('79,820.00'), 79820);
  assert.equal(parseNumber('401,25 m³'), 401.25);
  assert.equal(parseNumber('79820,125'), 79820.125);
  assert.equal(parseNumber('abc'), null);
});
