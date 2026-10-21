import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromPriceInput, toPriceInput, unitPrice, usesCent } from '../src/lib/format.ts';

test('Arbeitspreise: kWh in Cent, Wasser in Euro', () => {
  assert.equal(usesCent('kWh'), true);
  assert.equal(usesCent('m³'), false);
  assert.equal(fromPriceInput(31.5, 'kWh'), 0.315);
  assert.equal(toPriceInput(0.315, 'kWh'), 31.5);
  assert.equal(toPriceInput(0.3214, 'kWh'), 32.14);
  assert.equal(fromPriceInput(2.1, 'm³'), 2.1);
  assert.equal(unitPrice(0.315, 'kWh'), '31,50 ct/kWh');
  assert.equal(unitPrice(2.1, 'm³'), '2,10 €/m³');
});
