// Einstellungen, die nur dieses Gerät betreffen (im Browser gespeichert).

import { useSyncExternalStore } from 'react';
import type { NumberFormat } from './parse';

const NUMBER_FORMAT_KEY = 'meterbook.numberFormat';
const listeners = new Set<() => void>();

function read(): NumberFormat {
  try {
    return localStorage.getItem(NUMBER_FORMAT_KEY) === 'en' ? 'en' : 'de';
  } catch {
    return 'de';
  }
}

let numberFormat = read();

export function setNumberFormat(f: NumberFormat) {
  numberFormat = f;
  try {
    localStorage.setItem(NUMBER_FORMAT_KEY, f);
  } catch {
    // Ohne Speicher gilt die Wahl bis zum Neuladen.
  }
  listeners.forEach((l) => l());
}

/** Zahlenformat für Eingabefelder; Anzeigen bleiben deutsch. */
export function useNumberFormat(): NumberFormat {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => numberFormat,
  );
}

// Zuletzt gewählte Einteilung im Verlauf (Tage, Wochen, …) – gilt für alle Zähler.

export type ChartGranularity = 'day' | 'week' | 'month' | 'year' | 'billing';
const GRANULARITY_KEY = 'meterbook.chartGranularity';
const GRANULARITIES: ChartGranularity[] = ['day', 'week', 'month', 'year', 'billing'];

export function getChartGranularity(): ChartGranularity {
  try {
    const v = localStorage.getItem(GRANULARITY_KEY) as ChartGranularity | null;
    return v && GRANULARITIES.includes(v) ? v : 'month';
  } catch {
    return 'month';
  }
}

export function setChartGranularity(g: ChartGranularity) {
  try {
    localStorage.setItem(GRANULARITY_KEY, g);
  } catch {
    // Ohne Speicher gilt die Wahl nur auf dieser Seite.
  }
}
