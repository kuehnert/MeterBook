import ExcelJS from 'exceljs';
import { MeterData } from '../meters/meters.service';
import { BillingPeriod, SeriesBucket } from '../stats/stats.service';

export interface ExportMeter {
  data: MeterData;
  readings: Array<{ readAt: Date; values: Record<string, { value: number }>; source: string; note: string | null }>;
  monthly: SeriesBucket[];
  billing: BillingPeriod[];
}

const MEDIUM: Record<string, string> = {
  ELECTRICITY: 'Strom',
  WATER: 'Wasser',
  GAS: 'Gas',
  HEAT: 'Wärme',
  OTHER: 'Sonstiges',
};
const SOURCE: Record<string, string> = { MANUAL: 'manuell', PHOTO: 'Foto', IMPORT: 'Import' };

function header(ws: ExcelJS.Worksheet, columns: Array<{ header: string; key: string; width: number; numFmt?: string }>) {
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF4' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
}

export async function buildWorkbook(meters: ExportMeter[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MeterBook';
  wb.created = new Date();

  // Alle Ablesungen in Langform – am besten zum Weiterverarbeiten (Pivot, Power Query).
  const readings = wb.addWorksheet('Ablesungen');
  header(readings, [
    { header: 'Datum', key: 'date', width: 18, numFmt: 'dd.mm.yyyy hh:mm' },
    { header: 'Zähler', key: 'meter', width: 22 },
    { header: 'Art', key: 'medium', width: 10 },
    { header: 'Zählwerk', key: 'register', width: 16 },
    { header: 'Stand', key: 'value', width: 14, numFmt: '#,##0.000' },
    { header: 'Einheit', key: 'unit', width: 8 },
    { header: 'Quelle', key: 'source', width: 10 },
    { header: 'Notiz', key: 'note', width: 30 },
  ]);
  for (const m of meters) {
    for (const g of [...m.readings].sort((a, b) => a.readAt.getTime() - b.readAt.getTime())) {
      for (const r of m.data.meter.registers) {
        const v = g.values[r.id];
        if (!v) continue;
        readings.addRow({
          date: g.readAt,
          meter: m.data.meter.name,
          medium: MEDIUM[m.data.meter.medium] ?? m.data.meter.medium,
          register: r.name,
          value: v.value,
          unit: m.data.meter.unit,
          source: SOURCE[g.source] ?? g.source,
          note: g.note ?? '',
        });
      }
    }
  }

  // Monatsverbrauch: eine Zeile je Monat und Zähler.
  const monthly = wb.addWorksheet('Monatsverbrauch');
  header(monthly, [
    { header: 'Monat', key: 'month', width: 12, numFmt: 'mm.yyyy' },
    { header: 'Zähler', key: 'meter', width: 22 },
    { header: 'Zählwerk', key: 'register', width: 16 },
    { header: 'Verbrauch', key: 'value', width: 14, numFmt: '#,##0.00' },
    { header: 'Einheit', key: 'unit', width: 8 },
    { header: 'Geschätzt', key: 'estimated', width: 10 },
  ]);
  for (const m of meters) {
    for (const b of m.monthly) {
      for (const r of m.data.meter.registers) {
        const v = b.registers[r.id];
        if (!v || v.value === null) continue;
        monthly.addRow({
          month: b.start,
          meter: m.data.meter.name,
          register: r.name,
          value: v.value,
          unit: m.data.meter.unit,
          estimated: v.estimated || v.partial ? 'ja' : '',
        });
      }
    }
  }

  // Abrechnungsperioden mit Kosten und Abschlägen.
  const billing = wb.addWorksheet('Abrechnungsperioden');
  header(billing, [
    { header: 'Zähler', key: 'meter', width: 22 },
    { header: 'Periode', key: 'label', width: 10 },
    { header: 'Von', key: 'start', width: 12, numFmt: 'dd.mm.yyyy' },
    { header: 'Bis', key: 'end', width: 12, numFmt: 'dd.mm.yyyy' },
    { header: 'Zählwerk', key: 'register', width: 16 },
    { header: 'Verbrauch', key: 'value', width: 14, numFmt: '#,##0.00' },
    { header: 'Einheit', key: 'unit', width: 8 },
    { header: 'Arbeitskosten €', key: 'cost', width: 14, numFmt: '#,##0.00' },
    { header: 'Status', key: 'status', width: 16 },
  ]);
  for (const m of meters) {
    for (const p of m.billing) {
      const last = new Date(p.end.getTime() - 86_400_000);
      const status = p.current ? 'laufend' : p.registers && Object.values(p.registers).some((r) => r.partial) ? 'unvollständig' : '';
      for (const r of m.data.meter.registers) {
        const v = p.registers[r.id];
        billing.addRow({
          meter: m.data.meter.name,
          label: p.label,
          start: p.start,
          end: last,
          register: r.name,
          value: v?.value ?? null,
          unit: m.data.meter.unit,
          cost: v?.cost ?? null,
          status,
        });
      }
      if (p.cost) {
        billing.addRow({ meter: m.data.meter.name, label: p.label, start: p.start, end: last, register: 'Grundpreis', cost: p.cost.base, status });
        if (p.cost.bonus > 0) billing.addRow({ meter: m.data.meter.name, label: p.label, start: p.start, end: last, register: 'Boni', cost: -p.cost.bonus, status });
        const row = billing.addRow({ meter: m.data.meter.name, label: p.label, start: p.start, end: last, register: 'Summe', cost: p.cost.total, status });
        row.font = { bold: true };
        if (p.advances > 0) {
          billing.addRow({ meter: m.data.meter.name, label: p.label, start: p.start, end: last, register: 'Abschläge', cost: p.advances, status });
        }
      }
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
