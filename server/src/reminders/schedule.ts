// Termine der Erinnerungen in Ortszeit (TZ=Europe/Berlin): wöchentlich montags 9 Uhr,
// monatlich am 1. um 9 Uhr. Es gilt immer nur der aktuelle Termin – beginnt ein neuer,
// ist der alte erledigt.

export type ReminderInterval = 'OFF' | 'WEEKLY' | 'MONTHLY';

export const REMINDER_HOUR = 9;

/** Letzter Termin vor oder gleich `now`; null, wenn keine Erinnerung eingestellt ist. */
export function periodStart(interval: ReminderInterval, now: Date): Date | null {
  if (interval === 'WEEKLY') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), REMINDER_HOUR);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // zurück auf Montag
    if (d > now) d.setDate(d.getDate() - 7);
    return d;
  }
  if (interval === 'MONTHLY') {
    const d = new Date(now.getFullYear(), now.getMonth(), 1, REMINDER_HOUR);
    if (d > now) d.setMonth(d.getMonth() - 1);
    return d;
  }
  return null;
}

/** Nächster Termin nach `now`. */
export function nextStart(interval: ReminderInterval, now: Date): Date | null {
  const cur = periodStart(interval, now);
  if (!cur) return null;
  const d = new Date(cur);
  if (interval === 'WEEKLY') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/** Ablesungen ab diesem Zeitpunkt zählen für den Termin – auch die vom Vortag. */
export function readSince(start: Date): Date {
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
}
