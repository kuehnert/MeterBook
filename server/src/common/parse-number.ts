// Kopie von web/src/lib/parse.ts (parseDecimal) – beide Seiten lesen Zahlen gleich.

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

