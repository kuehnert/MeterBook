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
