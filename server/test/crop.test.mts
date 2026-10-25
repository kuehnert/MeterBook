import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxInCrop, cropFraction, cropPixels } from '../src/photos/crop.ts';

test('Ausschnitt umfasst alle Ziffern mit Rand', () => {
  // HT und NT übereinander in der Bildmitte
  const boxes: [number, number, number, number][] = [
    [0.4, 0.2, 0.4, 0.05],
    [0.4, 0.3, 0.4, 0.05],
  ];
  const f = cropFraction(boxes)!;
  assert.ok(f[0] < 0.4 && f[0] + f[2] > 0.8, 'waagrecht mit Rand');
  assert.ok(f[1] < 0.2 && f[1] + f[3] > 0.35, 'senkrecht mit Rand');
  const px = cropPixels(boxes, 2000, 1500)!;
  assert.ok(px.width < 2000 && px.height < 1500);
  assert.ok(px.left >= 0 && px.top >= 0 && px.left + px.width <= 2000 && px.top + px.height <= 1500);
});

test('Ausschnitt am Bildrand wird begrenzt', () => {
  const px = cropPixels([[0.0, 0.0, 0.3, 0.05]], 1000, 1000)!;
  assert.equal(px.left, 0);
  assert.equal(px.top, 0);
});

test('kein Zuschnitt ohne Boxen oder wenn fast alles übrig bliebe', () => {
  assert.equal(cropPixels([], 1000, 1000), null);
  assert.equal(cropPixels([[0, 0, 1, 1]], 1000, 1000), null);
});

test('Boxen im Ausschnitt', () => {
  const b = boxInCrop([0.5, 0.5, 0.1, 0.1], [0.4, 0.4, 0.4, 0.4]);
  assert.deepEqual(b.map((x) => Math.round(x * 1000) / 1000), [0.25, 0.25, 0.25, 0.25]);
});
