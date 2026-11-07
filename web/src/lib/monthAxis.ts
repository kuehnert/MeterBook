// Beschriftung der Monatsachse: Am Anfang jeder Abrechnungsperiode steht die Periode
// („2025“ beim Kalenderjahr, „2025/26“ z. B. bei einer Heizperiode ab August), am Ende
// der letzte Monat („Dezember“ bzw. „Juli“) – soweit die Säulen Platz lassen.

export interface MonthSlot {
  /** 0 = Januar … 11 = Dezember */
  month: number;
  /** Abrechnungsperiode, zu der der Monat gehört */
  period: string;
}

export interface AxisLabel {
  text: string;
  /** Position in Säulenbreiten ab dem linken Rand der ersten Säule */
  at: number;
  anchor: 'start' | 'end';
  /** Periodenname (fett) statt Monatsname */
  strong: boolean;
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** grobe Textbreite bei 12 px Schrift */
const CHAR = 6.6;
const GAP = 8;
const PAD = 5;

/** Indizes, an denen eine neue Periode beginnt (für die Trennstriche) */
export function periodStarts(slots: MonthSlot[]): number[] {
  return slots.flatMap((s, k) => (k > 0 && s.period !== slots[k - 1].period ? [k] : []));
}

/**
 * slot = Breite einer Säule in Pixeln. Der Periodenname hat Vorrang; der Monatsname am
 * Ende fällt weg, wenn er nicht neben den Namen passt.
 */
export function monthAxisLabels(slots: MonthSlot[], slot: number): AxisLabel[] {
  const out: AxisLabel[] = [];
  const width = (t: string) => t.length * CHAR;
  let i = 0;
  while (i < slots.length) {
    const period = slots[i].period;
    let j = i;
    while (j + 1 < slots.length && slots[j + 1].period === period) j++;
    // Säulen i..j gehören zu einer Periode (am Rand evtl. nur teilweise sichtbar)
    const left = i * slot;
    const right = (j + 1) * slot;

    const name = { from: left + PAD, to: left + PAD + width(period) };
    const showName = name.to <= right;
    if (showName) out.push({ text: period, at: i + PAD / slot, anchor: 'start', strong: true });

    // Ende nur beschriften, wenn die Periode im Bild auch wirklich endet (nicht bei der laufenden)
    if (j + 1 < slots.length) {
      const last = MONTHS[slots[j].month];
      const end = { from: right - PAD - width(last), to: right - PAD };
      if (end.from >= left && (!showName || name.to + GAP <= end.from)) {
        out.push({ text: last, at: j + 1 - PAD / slot, anchor: 'end', strong: false });
      }
    }
    i = j + 1;
  }
  return out;
}
