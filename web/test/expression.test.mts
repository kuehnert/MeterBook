import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpression, isExpression } from '../src/lib/parse.ts';

const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('Grundrechenarten mit deutschen Zahlen', () => {
  close(evaluateExpression('12*54'), 648);
  close(evaluateExpression('12 x 54,90'), 658.8);
  close(evaluateExpression('12 mal 54,90'), 658.8);
  close(evaluateExpression('649,80 / 12'), 54.15);
  close(evaluateExpression('649,80 : 12'), 54.15);
  close(evaluateExpression('100 + 20,5 - 0,5'), 120);
  close(evaluateExpression('1.234,5 * 2'), 2469);
});

test('Punkt vor Strich und Klammern', () => {
  close(evaluateExpression('2 + 3 * 4'), 14);
  close(evaluateExpression('(2 + 3) * 4'), 20);
  close(evaluateExpression('-5 * 2'), -10);
});

test('englisches Zahlenformat', () => {
  close(evaluateExpression('12 * 54.90', 'en'), 658.8);
});

test('Ungültiges ergibt null', () => {
  assert.equal(evaluateExpression('12 *'), null);
  assert.equal(evaluateExpression('12 / 0'), null);
  assert.equal(evaluateExpression('abc'), null);
  assert.equal(evaluateExpression('(1 + 2'), null);
});

test('Erkennt Rechnungen, aber keine einzelnen Zahlen', () => {
  assert.equal(isExpression('12 * 54'), true);
  assert.equal(isExpression('12 mal 54'), true);
  assert.equal(isExpression('-54,90'), false);
  assert.equal(isExpression('79.820,00'), false);
});
