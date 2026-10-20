export type Medium = 'ELECTRICITY' | 'WATER' | 'GAS' | 'HEAT' | 'OTHER';

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

export interface OcrResult {
  model: string;
  registers: Array<{ registerId: string; value: number | null; confidence: number; digits: string }>;
  serialNumberSeen: string | null;
  serialNumberMatches: boolean | null;
  issues: string[];
}

export interface UploadResult {
  photoId: string;
  takenAt: string;
  ocr: OcrResult | null;
  ocrError: string | null;
  warnings: RegisterWarnings[];
}

export interface Health {
  status: string;
  version: string;
  ocr: boolean;
}
