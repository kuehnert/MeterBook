import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { dateFromExif, dateFromFilename, resolveTakenAt } from '../src/photos/taken-at.ts';

const local = (s: string) => new Date(s).getTime(); // ohne Z = lokale Zeit

test('Datum aus typischen Dateinamen', () => {
  assert.equal(dateFromFilename('IMG_20261020_174912.jpg')?.getTime(), local('2026-10-20T17:49:12'));
  assert.equal(dateFromFilename('PXL_20261020_174912345.jpg')?.getTime(), local('2026-10-20T17:49:12'));
  assert.equal(dateFromFilename('20261020_174912.jpg')?.getTime(), local('2026-10-20T17:49:12'));
  assert.equal(dateFromFilename('Screenshot_2026-10-20-17-49-12.png')?.getTime(), local('2026-10-20T17:49:12'));
  assert.equal(dateFromFilename('IMG-20261020-WA0007.jpg')?.getTime(), local('2026-10-20T12:00:00'));
  assert.equal(dateFromFilename('zaehler.jpg'), null);
  assert.equal(dateFromFilename('upload_1792508636825.jpg'), null);
  assert.equal(dateFromFilename('IMG_20261340_250000.jpg'), null);
});

async function jpegWithExif(exif: Record<string, string>) {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } })
    .jpeg()
    .withExif({ IFD0: { Make: 'Test' }, IFD2: exif })
    .toBuffer();
}

test('EXIF DateTimeOriginal, mit und ohne Zeitzone', async () => {
  const withOffset = await sharp(await jpegWithExif({ DateTimeOriginal: '2026:10:20 07:15:30', OffsetTimeOriginal: '+02:00' })).metadata();
  assert.equal(dateFromExif(withOffset.exif)?.toISOString(), '2026-10-20T05:15:30.000Z');
  const naive = await sharp(await jpegWithExif({ DateTimeOriginal: '2026:10:20 07:15:30' })).metadata();
  assert.equal(dateFromExif(naive.exif)?.getTime(), local('2026-10-20T07:15:30'));
});

test('Reihenfolge: EXIF vor Dateiname vor Client vor jetzt', async () => {
  const now = local('2026-10-21T09:00:00');
  const exif = (await sharp(await jpegWithExif({ DateTimeOriginal: '2026:10:20 07:15:30' })).metadata()).exif;
  assert.equal(resolveTakenAt({ exif, fileName: 'IMG_20261019_100000.jpg', client: '2026-10-18T10:00:00Z' }, now).source, 'exif');
  assert.equal(resolveTakenAt({ fileName: 'IMG_20261019_100000.jpg', client: '2026-10-18T10:00:00Z' }, now).source, 'filename');
  assert.equal(resolveTakenAt({ fileName: 'foto.jpg', client: '2026-10-18T10:00:00Z' }, now).source, 'client');
  assert.equal(resolveTakenAt({ fileName: 'foto.jpg' }, now).source, 'now');
  // Zeitpunkt in der Zukunft (falsch gestellte Kamera) wird ignoriert
  assert.equal(resolveTakenAt({ fileName: 'IMG_20271019_100000.jpg' }, now).source, 'now');
});
