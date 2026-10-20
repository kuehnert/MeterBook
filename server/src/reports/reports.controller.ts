import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { MetersService } from '../meters/meters.service';
import { PrismaService } from '../prisma.service';
import { ReadingsService } from '../readings/readings.service';
import { StatsService } from '../stats/stats.service';
import { parseDate, parseImportFile, parseNumber } from './import';
import { PdfMeterSection, buildPdf } from './pdf';
import { ExportMeter, buildWorkbook } from './xlsx';

function contentDisposition(name: string) {
  return `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

@Controller()
export class ReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly meters: MetersService,
    private readonly readings: ReadingsService,
    private readonly stats: StatsService,
  ) {}

  private async collect(userId: string, meterIds?: string): Promise<ExportMeter[]> {
    const all = await this.meters.list(userId, true);
    const wanted = meterIds ? new Set(meterIds.split(',')) : null;
    const chosen = all.filter((m) => (wanted ? wanted.has(m.id) : !m.archived));
    return Promise.all(
      chosen.map(async (m) => {
        const data = await this.meters.loadData(userId, m.id);
        return {
          data,
          readings: await this.readings.list(userId, m.id),
          monthly: this.stats.computeSeries(data, 'month', '2000-01-01'),
          billing: this.stats.computeBilling(data),
        };
      }),
    );
  }

  @Get('export/xlsx')
  async xlsx(@CurrentUser() u: AuthUser, @Res() res: Response, @Query('meters') meterIds?: string) {
    const buf = await buildWorkbook(await this.collect(u.id, meterIds));
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', contentDisposition(`MeterBook-${stamp}.xlsx`));
    res.send(buf);
  }

  /**
   * Jahresbericht: je Zähler die Abrechnungsperiode, die im angegebenen Jahr beginnt.
   * So enthält z. B. "2025" beim Heizstrom (Stichtag Juli) Juli 2025 bis Juni 2026.
   */
  @Get('reports/annual.pdf')
  async annual(@CurrentUser() u: AuthUser, @Res() res: Response, @Query('year') yearRaw?: string, @Query('meters') meterIds?: string) {
    const year = Number(yearRaw ?? new Date().getFullYear() - 1);
    if (!Number.isInteger(year) || year < 1990 || year > 2100) throw new BadRequestException('Ungültiges Jahr');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    const meters = await this.collect(u.id, meterIds);
    const sections: PdfMeterSection[] = [];
    for (const meter of meters) {
      const period = meter.billing.find((p) => p.start.getFullYear() === year);
      if (!period) continue;
      const months = meter.monthly.filter((b) => b.start >= period.start && b.start < period.end);
      sections.push({ meter, period, months });
    }
    const buf = await buildPdf(`Verbrauchsbericht ${year}`, user.name, sections);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', contentDisposition(`MeterBook-Bericht-${year}.pdf`));
    res.send(buf);
  }

  @Get('import/template.csv')
  template(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition('MeterBook-Importvorlage.csv'));
    res.send(
      '﻿Datum;Zähler;Zählwerk;Stand;Notiz\n' +
        '01.07.2024;Heizstrom;HT;27450,3;Jahresablesung\n' +
        '01.07.2024;Heizstrom;NT;79112,0;Jahresablesung\n' +
        '31.12.2024;Wasser;;401,25;\n',
    );
  }

  /** CSV oder Excel. Mit dryRun=true wird nur geprüft und eine Vorschau zurückgegeben. */
  @Post('import/readings')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async import(
    @CurrentUser() u: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('dryRun') dryRun?: string,
  ) {
    if (!file) throw new BadRequestException('Keine Datei übertragen');
    let rows;
    try {
      rows = await parseImportFile(file.buffer, file.originalname);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Datei nicht lesbar');
    }
    const meters = await this.meters.list(u.id, true);
    const norm = (s: string) => s.trim().toLowerCase();
    const errors: Array<{ line: number; message: string }> = [];
    const groups = new Map<string, { meterId: string; meterName: string; readAt: Date; note: string; values: Array<{ registerId: string; registerName: string; value: number }> }>();

    for (const r of rows) {
      const meter = meters.find((m) => norm(m.name) === norm(r.meter) || (m.serialNumber && norm(m.serialNumber) === norm(r.meter)));
      if (!meter) {
        errors.push({ line: r.line, message: `Zähler „${r.meter}“ nicht gefunden` });
        continue;
      }
      const register = r.register
        ? meter.registers.find((x) => norm(x.name) === norm(r.register) || (x.code && norm(x.code) === norm(r.register)))
        : meter.registers.length === 1
          ? meter.registers[0]
          : undefined;
      if (!register) {
        errors.push({
          line: r.line,
          message: r.register
            ? `Zählwerk „${r.register}“ gibt es bei „${meter.name}“ nicht`
            : `„${meter.name}“ hat mehrere Zählwerke – Spalte Zählwerk ausfüllen`,
        });
        continue;
      }
      const readAt = parseDate(r.date);
      if (!readAt) {
        errors.push({ line: r.line, message: `Datum „${r.date}“ nicht lesbar` });
        continue;
      }
      const value = parseNumber(r.value);
      if (value === null || value < 0) {
        errors.push({ line: r.line, message: `Stand „${r.value}“ ist keine gültige Zahl` });
        continue;
      }
      const key = `${meter.id}|${readAt.getTime()}`;
      let g = groups.get(key);
      if (!g) {
        g = { meterId: meter.id, meterName: meter.name, readAt, note: r.note, values: [] };
        groups.set(key, g);
      }
      g.values = g.values.filter((v) => v.registerId !== register.id);
      g.values.push({ registerId: register.id, registerName: register.name, value });
    }

    const list = [...groups.values()].sort((a, b) => a.readAt.getTime() - b.readAt.getTime());
    if (dryRun === 'true' || errors.length > 0) {
      return { imported: 0, readings: list, errors };
    }
    for (const g of list) {
      await this.readings.save(u.id, g.meterId, {
        readAt: g.readAt.toISOString(),
        source: 'IMPORT',
        note: g.note || undefined,
        values: g.values.map((v) => ({ registerId: v.registerId, value: v.value })),
      });
    }
    return { imported: list.length, readings: list, errors };
  }

  @Get('meters/:id/export/csv')
  async csv(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const meter = await this.meters.find(u.id, id);
    const groups = await this.readings.list(u.id, id);
    const lines = ['Datum;Zähler;Zählwerk;Stand;Notiz'];
    for (const g of [...groups].reverse()) {
      for (const r of meter.registers) {
        const v = g.values[r.id];
        if (!v) continue;
        const d = g.readAt;
        const ds = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        lines.push([ds, meter.name, r.name, String(v.value).replace('.', ','), (g.note ?? '').replace(/;/g, ',')].join(';'));
      }
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(`${meter.name}.csv`));
    res.send('﻿' + lines.join('\n') + '\n');
  }
}
