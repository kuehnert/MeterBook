export type Medium = 'ELECTRICITY' | 'WATER' | 'GAS' | 'HEAT' | 'OTHER';
export type MeterIcon = 'ELECTRICITY' | 'HEATING' | 'WATER' | 'GAS' | 'HEAT' | 'OTHER';

export interface Register {
  id: string;
  name: string;
  code: string | null;
  decimals: number;
  lastReading: { readAt: string; value: number } | null;
}

export interface Meter {
  id: string;
  name: string;
  medium: Medium;
  icon: MeterIcon | null;
  unit: string;
  serialNumber: string | null;
  location: string | null;
  notes: string | null;
  ocrHint: string | null;
  billingStartMonth: number;
  billingStartDay: number;
  archived: boolean;
  sortOrder: number;
  lastReadAt: string | null;
  registers: Register[];
}

export interface ReadingGroup {
  readAt: string;
  photoId: string | null;
  source: 'MANUAL' | 'PHOTO' | 'IMPORT';
  note: string | null;
  values: Record<string, { id: string; value: number; ocrValue: number | null; ocrConfidence: number | null }>;
}

export interface Warning {
  code: string;
  message: string;
}

export interface RegisterWarnings {
  registerId: string;
  warnings: Warning[];
}

export interface RegisterValue {
  value: number | null;
  estimated: boolean;
  partial: boolean;
  forecast: boolean;
}

export interface SeriesBucket {
  start: string;
  end: string;
  label: string;
  registers: Record<string, RegisterValue>;
  total: number | null;
  previousYearTotal: number | null;
  cost: number | null;
  perDay: number | null;
}

export interface BillingPeriod {
  start: string;
  end: string;
  label: string;
  current: boolean;
  registers: Record<string, RegisterValue & { cost: number | null }>;
  total: number | null;
  forecastTotal: number | null;
  cost: { energy: number; base: number; total: number; missingTariff: boolean } | null;
  forecastCost: number | null;
  advances: number;
  forecastAdvances: number | null;
  balance: number | null;
}

export interface Overview {
  meter: Meter;
  perDayLast30: Record<string, number | null>;
  perDayLastYear: Record<string, number | null>;
  currentPeriod: BillingPeriod | null;
  previousPeriod: BillingPeriod | null;
  nextBillingStart: string;
  daysSinceLastReading: number | null;
}

export interface Tariff {
  id: string;
  name: string | null;
  validFrom: string;
  basePricePerMonth: number;
  components: Array<{ id: string; registerId: string; label: string; pricePerUnit: number }>;
}

export interface Advance {
  id: string;
  validFrom: string;
  amountPerMonth: number;
  note: string | null;
}

export interface Exchange {
  id: string;
  registerId: string;
  exchangedAt: string;
  oldFinalValue: number;
  newInitialValue: number;
  note: string | null;
}

/** Lage im Bild als [links, oben, Breite, Höhe], Anteile 0–1 */
export type Box = [number, number, number, number];

export interface OcrResult {
  model: string;
  /** Erkannter Zähler (bei automatischer Zuordnung) */
  meterId: string | null;
  meterConfidence: number;
  registers: Array<{ registerId: string; value: number | null; confidence: number; digits: string; box: Box | null }>;
  serialNumberSeen: string | null;
  serialNumberMatches: boolean | null;
  issues: string[];
}

export interface UploadResult {
  photoId: string;
  /** Zugeordneter Zähler; null, wenn die automatische Erkennung keinen gefunden hat */
  meterId: string | null;
  takenAt: string;
  takenAtSource: 'exif' | 'filename' | 'client' | 'now';
  /** NONE | PENDING (Erkennung läuft im Hintergrund) | DONE | FAILED */
  ocrStatus: string;
  ocr: OcrResult | null;
  ocrError: string | null;
  warnings: RegisterWarnings[];
}

export interface Health {
  status: string;
  version: string;
  ocr: boolean;
  /** Name der Umgebung, z. B. "dev"; null = Produktion */
  env: string | null;
  /** smtp = E-Mails werden verschickt; outbox = nur abgelegt (Testbetrieb) */
  mail?: 'smtp' | 'outbox';
}

export type ReminderInterval = 'OFF' | 'WEEKLY' | 'MONTHLY';

export interface ReminderState {
  interval: ReminderInterval;
  email: boolean;
  skipUntil: string | null;
  current: string | null;
  next: string | null;
  skipped: boolean;
  due: { id: string; name: string }[];
  active: boolean;
}

/** Foto im Eingang: hochgeladen, aber noch keine Ablesung daraus gespeichert */
export interface InboxItem {
  photoId: string;
  meterId: string | null;
  takenAt: string;
  createdAt: string;
  /** NONE | PENDING | DONE | FAILED */
  ocrStatus: string;
  ocr: OcrResult | null;
  ocrError: string | null;
  /** schon auf die Ziffern zugeschnitten */
  cropped: boolean;
}
