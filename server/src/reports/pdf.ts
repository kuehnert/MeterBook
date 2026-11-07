import PDFDocument from 'pdfkit';
import { BillingPeriod, SeriesBucket } from '../stats/stats.service';
import { ExportMeter } from './xlsx';

export interface PdfMeterSection {
  meter: ExportMeter;
  period: BillingPeriod;
  months: SeriesBucket[];
}

const C = {
  text: '#1f2933',
  muted: '#616e7c',
  line: '#d9e2ec',
  accent: '#2f6fb0',
  prev: '#9fb3c8',
  warn: '#b44d12',
};

const nf = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined ? '–' : n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const eur = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${nf(n, 2)} €`);
const date = (d: Date) => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

type Doc = PDFKit.PDFDocument;

interface Col {
  label: string;
  width: number;
  align?: 'left' | 'right';
}

function table(doc: Doc, cols: Col[], rows: Array<Array<string>>, opts: { boldLast?: boolean } = {}) {
  const x0 = doc.page.margins.left;
  const rowH = 18;
  const draw = (cells: string[], bold: boolean, y: number, color = C.text) => {
    let x = x0;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(color);
    cells.forEach((c, i) => {
      doc.text(c, x + 4, y + 5, { width: cols[i].width - 8, align: cols[i].align ?? 'left', lineBreak: false });
      x += cols[i].width;
    });
  };
  const total = cols.reduce((s, c) => s + c.width, 0);
  let y = doc.y;
  const ensure = () => {
    if (y + rowH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }
  };
  ensure();
  doc.rect(x0, y, total, rowH).fill('#f0f4f8');
  draw(cols.map((c) => c.label), true, y, C.muted);
  y += rowH;
  rows.forEach((r, i) => {
    ensure();
    draw(r, !!opts.boldLast && i === rows.length - 1, y);
    y += rowH;
    doc.moveTo(x0, y).lineTo(x0 + total, y).lineWidth(0.5).strokeColor(C.line).stroke();
  });
  doc.x = x0;
  doc.y = y + 10;
}

function heading(doc: Doc, text: string, size = 15) {
  doc.font('Helvetica-Bold').fontSize(size).fillColor(C.text).text(text, doc.page.margins.left);
  doc.moveDown(0.3);
}

function muted(doc: Doc, text: string) {
  doc.font('Helvetica').fontSize(9.5).fillColor(C.muted).text(text, doc.page.margins.left);
}

function barChart(doc: Doc, months: SeriesBucket[], unit: string) {
  const x0 = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const h = 140;
  if (doc.y + h + 40 > doc.page.height - doc.page.margins.bottom) doc.addPage();
  const top = doc.y + 6;
  const max = Math.max(1, ...months.map((m) => Math.max(m.total ?? 0, m.previousYearTotal ?? 0)));
  const slot = w / Math.max(1, months.length);
  const barW = Math.min(26, slot * 0.6);

  doc.font('Helvetica').fontSize(7.5).fillColor(C.muted);
  for (let i = 0; i <= 4; i++) {
    const y = top + h - (h * i) / 4;
    doc.moveTo(x0, y).lineTo(x0 + w, y).lineWidth(0.4).strokeColor(C.line).stroke();
    doc.text(nf((max * i) / 4, 0), x0 - 46, y - 4, { width: 42, align: 'right', lineBreak: false });
  }
  months.forEach((m, i) => {
    const cx = x0 + slot * i + slot / 2;
    if (m.total !== null) {
      const bh = (h * m.total) / max;
      const est = Object.values(m.registers).some((r) => r.estimated || r.partial);
      doc.rect(cx - barW / 2, top + h - bh, barW, bh).fillOpacity(est ? 0.45 : 1).fill(C.accent).fillOpacity(1);
    }
    if (m.previousYearTotal !== null) {
      const y = top + h - (h * m.previousYearTotal) / max;
      doc.moveTo(cx - barW / 2 - 3, y).lineTo(cx + barW / 2 + 3, y).lineWidth(2).strokeColor(C.prev).stroke();
    }
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(m.label.split(' ')[0], cx - slot / 2, top + h + 4, {
      width: slot,
      align: 'center',
      lineBreak: false,
    });
  });
  doc.y = top + h + 18;
  doc.x = x0;
  doc.rect(x0, doc.y + 2, 10, 7).fill(C.accent);
  doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(`Verbrauch in ${unit}`, x0 + 14, doc.y, { continued: false, lineBreak: false });
  doc.moveTo(x0 + 120, doc.y + 5).lineTo(x0 + 134, doc.y + 5).lineWidth(2).strokeColor(C.prev).stroke();
  doc.text('Vorjahr', x0 + 138, doc.y, { lineBreak: false });
  doc.text('blass = geschätzt', x0 + 190, doc.y, { lineBreak: false });
  doc.y += 18;
  doc.x = x0;
}

export function buildPdf(title: string, userName: string, sections: PdfMeterSection[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 60, right: 50 }, info: { Title: title, Author: 'MeterBook' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Übersicht
  doc.font('Helvetica-Bold').fontSize(22).fillColor(C.text).text(title);
  doc.moveDown(0.2);
  muted(doc, `${userName} · erstellt am ${date(new Date())}`);
  doc.moveDown(1.2);

  if (sections.length === 0) {
    doc.font('Helvetica').fontSize(11).fillColor(C.text).text('Für diesen Zeitraum liegen keine Ablesungen vor.');
  } else {
    heading(doc, 'Übersicht', 13);
    table(
      doc,
      [
        { label: 'Zähler', width: 130 },
        { label: 'Zeitraum', width: 120 },
        { label: 'Verbrauch', width: 85, align: 'right' },
        { label: 'Kosten', width: 75, align: 'right' },
        { label: 'Saldo', width: 75, align: 'right' },
      ],
      sections.map(({ meter, period }) => {
        const unit = meter.data.meter.unit;
        const cost = period.current ? period.forecastCost : (period.cost?.total ?? null);
        return [
          meter.data.meter.name,
          `${date(period.start)}–${date(new Date(period.end.getTime() - 86_400_000))}`,
          `${nf(period.current ? period.forecastTotal : period.total, 0)} ${unit}`,
          eur(cost),
          period.balance === null ? '–' : `${period.balance > 0 ? '+' : ''}${nf(period.balance, 2)} €`,
        ];
      }),
    );
    muted(doc, 'Laufende Perioden sind auf das Periodenende hochgerechnet. Saldo: positiv = voraussichtliche Nachzahlung, negativ = Guthaben.');
  }

  for (const { meter, period, months } of sections) {
    doc.addPage();
    const m = meter.data.meter;
    heading(doc, m.name, 17);
    muted(
      doc,
      [
        `Abrechnungszeitraum ${date(period.start)} bis ${date(new Date(period.end.getTime() - 86_400_000))}`,
        m.serialNumber ? `Zählernummer ${m.serialNumber}` : null,
        period.current ? 'laufende Periode' : null,
      ]
        .filter(Boolean)
        .join(' · '),
    );
    doc.moveDown(0.8);

    const rows = m.registers.map((r) => {
      const v = period.registers[r.id];
      const flags = [v?.estimated ? 'geschätzt' : null, v?.partial ? 'unvollständig' : null].filter(Boolean).join(', ');
      return [r.name, `${nf(v?.value, 1)} ${m.unit}`, eur(v?.cost), flags];
    });
    if (period.cost) {
      rows.push(['Grundpreis', '', eur(period.cost.base), '']);
      if (period.cost.bonus > 0) rows.push(['Boni', '', eur(-period.cost.bonus), 'anteilig fürs erste Vertragsjahr']);
      rows.push([period.current ? 'Summe bisher' : 'Summe', `${nf(period.total, 1)} ${m.unit}`, eur(period.cost.total), period.cost.missingTariff ? 'Tarif fehlt teilweise' : '']);
    }
    table(
      doc,
      [
        { label: 'Zählwerk', width: 130 },
        { label: 'Verbrauch', width: 110, align: 'right' },
        { label: 'Kosten', width: 90, align: 'right' },
        { label: 'Hinweis', width: 155 },
      ],
      rows,
      { boldLast: !!period.cost },
    );

    if (period.current && period.forecastTotal !== null) {
      doc.font('Helvetica').fontSize(10).fillColor(C.text).text(
        `Hochrechnung bis Periodenende: ${nf(period.forecastTotal, 0)} ${m.unit}` +
          (period.forecastCost !== null ? `, ${eur(period.forecastCost)}` : ''),
      );
      doc.moveDown(0.5);
    }
    if (period.advances > 0 || period.forecastAdvances) {
      doc.font('Helvetica').fontSize(10).fillColor(C.text).text(
        `Abschläge ${period.current ? 'bisher' : 'gesamt'}: ${eur(period.advances)}` +
          (period.balance !== null
            ? ` · ${period.balance > 0 ? 'voraussichtliche Nachzahlung' : 'voraussichtliches Guthaben'}: ${eur(Math.abs(period.balance))}`
            : ''),
      );
      doc.moveDown(0.5);
    }

    if (months.length > 0) {
      doc.moveDown(0.5);
      heading(doc, 'Verbrauch je Monat', 12);
      barChart(doc, months, m.unit);
    }

    const inPeriod = meter.readings
      .filter((g) => g.readAt >= period.start && g.readAt < period.end)
      .sort((a, b) => a.readAt.getTime() - b.readAt.getTime());
    if (inPeriod.length > 0) {
      heading(doc, 'Ablesungen im Zeitraum', 12);
      const regW = Math.floor(330 / m.registers.length);
      table(
        doc,
        [{ label: 'Datum', width: 90 }, ...m.registers.map((r) => ({ label: r.name, width: regW, align: 'right' as const })), { label: 'Quelle', width: 65 }],
        inPeriod.map((g) => [
          date(g.readAt),
          ...m.registers.map((r) => (g.values[r.id] ? nf(g.values[r.id].value, r.decimals) : '–')),
          g.source === 'PHOTO' ? 'Foto' : g.source === 'IMPORT' ? 'Import' : 'manuell',
        ]),
      );
    }
  }

  doc.end();
  return done;
}
