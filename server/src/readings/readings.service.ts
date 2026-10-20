import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { num } from '../common/util';
import { MetersService } from '../meters/meters.service';
import { PrismaService } from '../prisma.service';
import { PlausibilityWarning, checkReading } from '../stats/analytics';

export class ReadingValueDto {
  @IsString()
  registerId: string;
  @IsNumber({}, { message: 'Bitte eine Zahl eingeben' })
  @Min(0)
  value: number;
  @IsOptional()
  @IsNumber()
  ocrValue?: number;
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  ocrConfidence?: number;
}

export class ReadingGroupDto {
  @IsDateString({}, { message: 'Ungültiges Datum' })
  readAt: string;
  /** Beim Bearbeiten: bisheriger Zeitpunkt der Ablesung */
  @IsOptional()
  @IsDateString()
  originalReadAt?: string;
  @IsOptional()
  @IsString()
  photoId?: string;
  @IsOptional()
  @IsIn(['MANUAL', 'PHOTO', 'IMPORT'])
  source?: 'MANUAL' | 'PHOTO' | 'IMPORT';
  @IsOptional()
  @IsString()
  note?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReadingValueDto)
  values: ReadingValueDto[];
}

export interface RegisterWarnings {
  registerId: string;
  warnings: PlausibilityWarning[];
}

@Injectable()
export class ReadingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly meters: MetersService,
  ) {}

  /** Ablesungen eines Zählers, zusammengefasst nach Zeitpunkt (eine Zeile pro Ablesetermin). */
  async list(userId: string, meterId: string) {
    const meter = await this.meters.find(userId, meterId);
    const readings = await this.prisma.reading.findMany({
      where: { registerId: { in: meter.registers.map((r) => r.id) } },
      orderBy: { readAt: 'desc' },
    });
    const groups = new Map<
      number,
      {
        readAt: Date;
        photoId: string | null;
        source: string;
        note: string | null;
        values: Record<string, { id: string; value: number; ocrValue: number | null; ocrConfidence: number | null }>;
      }
    >();
    for (const r of readings) {
      const key = r.readAt.getTime();
      let g = groups.get(key);
      if (!g) {
        g = { readAt: r.readAt, photoId: r.photoId, source: r.source, note: r.note, values: {} };
        groups.set(key, g);
      }
      g.photoId ??= r.photoId;
      g.note ??= r.note;
      g.values[r.registerId] = {
        id: r.id,
        value: num(r.value)!,
        ocrValue: num(r.ocrValue),
        ocrConfidence: r.ocrConfidence,
      };
    }
    return [...groups.values()];
  }

  async check(userId: string, meterId: string, dto: ReadingGroupDto): Promise<RegisterWarnings[]> {
    const data = await this.meters.loadData(userId, meterId);
    const t = new Date(dto.readAt);
    const ignore = dto.originalReadAt ? new Date(dto.originalReadAt).getTime() : null;
    const out: RegisterWarnings[] = [];
    for (const v of dto.values) {
      const pts = (data.series[v.registerId] ?? []).filter((p) => p.t !== ignore && p.t !== t.getTime());
      const normalized = v.value + (await this.meters.exchangeOffset(v.registerId, t));
      out.push({ registerId: v.registerId, warnings: checkReading(pts, t.getTime(), normalized, data.meter.unit) });
    }
    return out;
  }

  /**
   * Legt eine Ablesung an bzw. ersetzt sie. Gibt es zum selben Zeitpunkt schon einen Wert für
   * ein Zählwerk, wird er überschrieben – so führt ein wiederholter Upload aus der App nicht zu
   * doppelten Einträgen.
   */
  async save(userId: string, meterId: string, dto: ReadingGroupDto) {
    const meter = await this.meters.find(userId, meterId);
    const regIds = meter.registers.map((r) => r.id);
    if (dto.values.some((v) => !regIds.includes(v.registerId))) throw new BadRequestException('Unbekanntes Zählwerk');
    if (dto.photoId) {
      const photo = await this.prisma.photo.findFirst({ where: { id: dto.photoId, meterId } });
      if (!photo) throw new BadRequestException('Foto gehört nicht zu diesem Zähler');
    }
    const readAt = new Date(dto.readAt);
    if (readAt.getTime() > Date.now() + 10 * 60_000) throw new BadRequestException('Ablesung liegt in der Zukunft');
    const warnings = await this.check(userId, meterId, dto);

    await this.prisma.$transaction(async (tx) => {
      if (dto.originalReadAt) {
        await tx.reading.deleteMany({
          where: {
            registerId: { in: regIds },
            readAt: new Date(dto.originalReadAt),
          },
        });
      }
      for (const v of dto.values) {
        const existing = await tx.reading.findFirst({ where: { registerId: v.registerId, readAt } });
        const data = {
          value: v.value,
          source: dto.source ?? (dto.photoId ? 'PHOTO' : 'MANUAL'),
          photoId: dto.photoId ?? null,
          ocrValue: v.ocrValue ?? null,
          ocrConfidence: v.ocrConfidence ?? null,
          note: dto.note ?? null,
        };
        if (existing) await tx.reading.update({ where: { id: existing.id }, data });
        else await tx.reading.create({ data: { ...data, registerId: v.registerId, readAt } });
      }
    });
    return { warnings };
  }

  async removeGroup(userId: string, meterId: string, readAt: string) {
    const meter = await this.meters.find(userId, meterId);
    const d = new Date(readAt);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Ungültiges Datum');
    const res = await this.prisma.reading.deleteMany({
      where: { registerId: { in: meter.registers.map((r) => r.id) }, readAt: d },
    });
    if (res.count === 0) throw new NotFoundException('Ablesung nicht gefunden');
  }
}
