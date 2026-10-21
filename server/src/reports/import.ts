import ExcelJS from 'exceljs';
import { parseDecimal } from '../common/parse-number';

export interface RawImportRow {
  line: number;
  date: string;
  meter: string;
  register: string;
  value: string;
  note: string;
}

const ALIASES: Record<keyof Omit<RawImportRow, 'line'>, string[]> = {
  date: ['datum', 'date', 'ablesedatum', 'zeitpunkt'],
  meter: ['zähler', 'zaehler', 'meter', 'messstelle'],
  register: ['zählwerk', 'zaehlwerk', 'register', 'tarif'],
  value: ['stand', 'zählerstand', 'zaehlerstand', 'wert', 'value'],
  note: ['notiz', 'bemerkung', 'note'],
};

function mapHeader(cells: string[]) {
  const idx: Partial<Record<keyof typeof ALIASES, number>> = {};
  cells.forEach((c, i) => {
    const key = c.trim().toLowerCase();
    for (const [field, names] of Object.entries(ALIASES)) {
      if (names.includes(key)) idx[field as keyof typeof ALIASES] = i;
    }
  });
  return idx;
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function toRows(table: string[][]): RawImportRow[] {
  if (table.length === 0) throw new Error('Die Datei ist leer');
  const idx = mapHeader(table[0]);
  if (idx.date === undefined || idx.meter === undefined || idx.value === undefined) {
    throw new Error('Kopfzeile nicht erkannt. Benötigt werden die Spalten Datum, Zähler und Stand (optional Zählwerk, Notiz).');
  }
  const get = (r: string[], i: number | undefined) => (i === undefined ? '' : (r[i] ?? '').trim());
  return table
    .slice(1)
    .map((r, n) => ({
      line: n + 2,
      date: get(r, idx.date),
      meter: get(r, idx.meter),
      register: get(r, idx.register),
      value: get(r, idx.value),
      note: get(r, idx.note),
    }))
    .filter((r) => r.date || r.meter || r.value);
}

export async function parseImportFile(buffer: Buffer, fileName: string): Promise<RawImportRow[]> {
  if (/\.xlsx$/i.test(fileName)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('Die Excel-Datei enthält kein Tabellenblatt');
    const table: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const v = cell.value;
        cells[col - 1] =
          v instanceof Date
            ? v.toISOString()
            : typeof v === 'number'
              ? // Excel-Zahlen sind eindeutig – mit Dezimalkomma, damit 79820.125 nicht als Tausender gilt
                String(v).replace('.', ',')
              : v && typeof v === 'object' && 'result' in v
                ? String((v as { result: unknown }).result ?? '')
                : String(v ?? '');
      });
      table.push(cells);
    });
    return toRows(table);
  }
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const sep = (lines[0] ?? '').includes(';') ? ';' : (lines[0] ?? '').includes('\t') ? '\t' : ',';
  return toRows(lines.map((l) => splitCsvLine(l, sep)));
}

/** Akzeptiert 31.12.2024, 31.12.2024 18:30, 2024-12-31, 2024-12-31T18:30 und ISO-Zeitstempel. */
export function parseDate(s: string): Date | null {
  const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (de) {
    let y = Number(de[3]);
    if (y < 100) y += 2000;
    const d = new Date(y, Number(de[2]) - 1, Number(de[1]), Number(de[4] ?? 12), Number(de[5] ?? 0));
    return d.getDate() === Number(de[1]) ? d : null;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Akzeptiert 29789,6 · 29.789,6 · 29789.6 · 79,820.00 (englisch) – siehe parseDecimal */
export function parseNumber(s: string): number | null {
  return parseDecimal(s, 'de');
}
