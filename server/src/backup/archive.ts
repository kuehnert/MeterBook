// Datei-Format für Datenmitnahme und Sicherung: ein ZIP mit meterbook.json und photos/<key>.jpg.
// Eine reine JSON-Datei (ohne Fotos) wird beim Einlesen ebenfalls akzeptiert.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export const JSON_NAME = 'meterbook.json';

export function buildArchive(data: unknown, photos: Map<string, Buffer>): Buffer {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    [JSON_NAME]: strToU8(JSON.stringify(data, null, 1)),
  };
  // JPEGs sind schon komprimiert – nur ablegen
  for (const [key, buf] of photos) files[`photos/${key}.jpg`] = [new Uint8Array(buf), { level: 0 }];
  return Buffer.from(zipSync(files, { level: 6 }));
}

export function readArchive(buf: Buffer): { data: unknown; photos: Map<string, Buffer> } {
  const photos = new Map<string, Buffer>();
  // ZIP beginnt mit "PK"
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return { data: parseJson(buf.toString('utf8')), photos };
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buf));
  } catch {
    throw new Error('Die ZIP-Datei ist beschädigt');
  }
  const json = files[JSON_NAME];
  if (!json) throw new Error(`In der ZIP-Datei fehlt ${JSON_NAME}`);
  for (const [name, content] of Object.entries(files)) {
    const m = name.match(/^photos\/([\w-]+)\.jpg$/);
    if (m) photos.set(m[1], Buffer.from(content));
  }
  return { data: parseJson(strFromU8(json)), photos };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('Die Datei ist kein gültiges MeterBook-Format');
  }
}
