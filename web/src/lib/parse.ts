// Eingaben aus Tastatur oder Zwischenablage lesen – ohne Abhängigkeiten, damit die Tests mit
// "node --test" direkt laufen.

/** Zahlenformat bei der Eingabe: de = 1.234,5 · en = 1,234.5 */
export type NumberFormat = 'de' | 'en';

/**
 * Liest Zahlen in deutscher und englischer Schreibweise, z. B. von der Website des Versorgers:
 * 79.820,00 · 79,820.00 · 79820,5 · 79820.5 · 1 234,5 · 79.820 kWh
 *
 * Kommen Punkt und Komma vor, ist das letzte Zeichen das Dezimaltrennzeichen. Kommt nur eines
 * mehrfach vor, trennt es Tausender. Nur bei genau einem Trennzeichen mit genau drei Ziffern
 * dahinter (79,820 oder 79.820) ist es mehrdeutig – dann entscheidet das eingestellte Format.
 */
export function parseDecimal(input: string, format: NumberFormat = 'de'): number | null {
  let t = input
    .trim()
    .replace(/[\s  ']/g, '')
    .replace(/^[^\d+\-.,]+/, '')
    .replace(/[^\d.,]+$/, '');
  let sign = 1;
  if (t.startsWith('-')) {
    sign = -1;
    t = t.slice(1);
  } else if (t.startsWith('+')) t = t.slice(1);
  if (!/^[\d.,]+$/.test(t) || !/\d/.test(t)) return null;

  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  let decimal: '.' | ',' | null;
  if (lastDot >= 0 && lastComma >= 0) {
    decimal = lastDot > lastComma ? '.' : ',';
  } else if (lastDot < 0 && lastComma < 0) {
    decimal = null;
  } else {
    const sep = lastDot >= 0 ? '.' : ',';
    const count = t.split(sep).length - 1;
    const after = t.length - t.lastIndexOf(sep) - 1;
    if (count > 1) decimal = null;
    else if (after !== 3) decimal = sep;
    else decimal = (format === 'de' ? ',' : '.') === sep ? sep : null;
  }

  const thousands = decimal === ',' ? '.' : decimal === '.' ? ',' : t.includes('.') ? '.' : ',';
  const [intPart, fracPart, ...rest] = decimal ? t.split(decimal) : [t];
  if (rest.length > 0) return null;
  if (fracPart !== undefined && !/^\d*$/.test(fracPart)) return null;
  // Tausendertrennzeichen nur an gültigen Stellen: 1.234.567, nicht 12.34
  if (intPart.includes(thousands) && !new RegExp(`^\\d{1,3}(\\${thousands}\\d{3})+$`).test(intPart)) return null;
  const digits = intPart.split(thousands).join('');
  if (!/^\d*$/.test(digits) || (digits === '' && !fracPart)) return null;
  return sign * Number(`${digits || '0'}.${fracPart || '0'}`);
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Liest ein getipptes oder eingefügtes Datum und liefert "YYYY-MM-DD HH:mm:ss" (lokale Zeit):
 * 02.08.2025 · 2.8.25 · 02.08.2025 14:30 · 2025-08-02 · 2025-08-02T14:30 · 02/08/2025
 * Ohne Uhrzeit gilt defaultTime (Standard 10:00). Zweistellige Jahre zählen ab 2000.
 */
export function parseDateInput(input: string, defaultTime = '10:00'): string | null {
  const s = input.trim().replace(/\s*Uhr$/i, '');
  let y: number, mo: number, d: number;
  let rest: string;
  const de = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?![\d])(.*)$/);
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/);
  if (de) {
    [d, mo, y] = [Number(de[1]), Number(de[2]), Number(de[3])];
    if (de[3].length === 2) y += 2000;
    rest = de[4];
  } else if (iso) {
    [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    rest = iso[4];
  } else return null;

  let time = defaultTime;
  if (rest.trim() !== '') {
    const t = rest.match(/^(?:[ T]+|,\s*)(\d{1,2})[:.](\d{2})(?::(\d{2}))?$/);
    if (!t) return null;
    time = `${t[1]}:${t[2]}${t[3] ? `:${t[3]}` : ''}`;
  }
  const [h, mi, sec = 0] = time.split(':').map(Number);
  if (h > 23 || mi > 59 || sec > 59) return null;
  const date = new Date(y, mo - 1, d, h, mi, sec);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(sec)}`;
}

/** Nur das Datum, z. B. für "Gültig ab": liefert "YYYY-MM-DD". */
export function parseDateOnlyInput(input: string): string | null {
  return parseDateInput(input, '00:00')?.slice(0, 10) ?? null;
}
