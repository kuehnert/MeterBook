// Termine der Erinnerungen in Ortszeit (TZ=Europe/Berlin), jeweils um 9 Uhr:
// wöchentlich montags, monatlich am 1., vierteljährlich am 1.1./1.4./1.7./1.10. und jährlich
// zum Abrechnungsbeginn des Zählers. Es gilt immer nur der aktuelle Termin – beginnt ein neuer,
// ist der alte erledigt.

export type ReminderInterval = 'OFF' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export const REMINDER_INTERVALS: ReminderInterval[] = ['OFF', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'];

export const REMINDER_HOUR = 9;

/** Beginn der Abrechnung (für „jährlich“); Standard 1.1. */
export interface YearStart {
  month: number; // 1–12
  day: number; // 1–28
}

const JAN_1: YearStart = { month: 1, day: 1 };

/** Letzter Termin vor oder gleich `now`; null, wenn keine Erinnerung eingestellt ist. */
export function periodStart(interval: ReminderInterval, now: Date, year: YearStart = JAN_1): Date | null {
  switch (interval) {
    case 'WEEKLY': {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), REMINDER_HOUR);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // zurück auf Montag
      if (d > now) d.setDate(d.getDate() - 7);
      return d;
    }
    case 'MONTHLY': {
      const d = new Date(now.getFullYear(), now.getMonth(), 1, REMINDER_HOUR);
      if (d > now) d.setMonth(d.getMonth() - 1);
      return d;
    }
    case 'QUARTERLY': {
      const d = new Date(now.getFullYear(), now.getMonth() - (now.getMonth() % 3), 1, REMINDER_HOUR);
      if (d > now) d.setMonth(d.getMonth() - 3);
      return d;
    }
    case 'YEARLY': {
      const d = new Date(now.getFullYear(), year.month - 1, year.day, REMINDER_HOUR);
      if (d > now) d.setFullYear(d.getFullYear() - 1);
      return d;
    }
    default:
      return null;
  }
}

/** Nächster Termin nach `now`. */
export function nextStart(interval: ReminderInterval, now: Date, year: YearStart = JAN_1): Date | null {
  const cur = periodStart(interval, now, year);
  if (!cur) return null;
  const d = new Date(cur);
  if (interval === 'WEEKLY') d.setDate(d.getDate() + 7);
  else if (interval === 'MONTHLY') d.setMonth(d.getMonth() + 1);
  else if (interval === 'QUARTERLY') d.setMonth(d.getMonth() + 3);
  else d.setFullYear(d.getFullYear() + 1);
  return d;
}

/** Ablesungen ab diesem Zeitpunkt zählen für den Termin – auch die vom Vortag. */
export function readSince(start: Date): Date {
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
}
