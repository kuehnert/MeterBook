import type { Medium } from './types';

export const MEDIUM_LABEL: Record<Medium, string> = {
  ELECTRICITY: 'Strom',
  WATER: 'Wasser',
  GAS: 'Gas',
  HEAT: 'Wärme',
  OTHER: 'Sonstiges',
};

export const MEDIUM_COLOR: Record<Medium, string> = {
  ELECTRICITY: 'yellow',
  WATER: 'blue',
  GAS: 'orange',
  HEAT: 'red',
  OTHER: 'gray',
};

export function num(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  return n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function eur(n: number | null | undefined): string {
  if (n === null || n === undefined) return '–';
  return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

/** Preis pro Einheit mit bis zu 4 Nachkommastellen (z. B. 0,3125 €) */
export function price(n: number): string {
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`;
}

export function date(s: string | Date | null | undefined): string {
  if (!s) return '–';
  return new Date(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function dateTime(s: string | Date | null | undefined): string {
  if (!s) return '–';
  return new Date(s).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Letzter Tag einer Periode, deren Ende exklusiv angegeben ist. */
export function lastDay(endExclusive: string): string {
  return date(new Date(new Date(endExclusive).getTime() - 86_400_000));
}

export function daysAgo(n: number | null): string {
  if (n === null) return 'noch nie abgelesen';
  if (n === 0) return 'heute abgelesen';
  if (n === 1) return 'gestern abgelesen';
  return `vor ${n} Tagen abgelesen`;
}

export const MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];
