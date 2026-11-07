import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength, ValidateNested } from 'class-validator';

export const MEDIA = ['ELECTRICITY', 'WATER', 'GAS', 'HEAT', 'OTHER'] as const;
export const ICONS = ['ELECTRICITY', 'HEATING', 'WATER', 'GAS', 'HEAT', 'OTHER'] as const;

export class RegisterDto {
  @IsOptional()
  @IsString()
  id?: string;
  @IsString()
  @MinLength(1, { message: 'Jedes Zählwerk braucht einen Namen' })
  name: string;
  @IsOptional()
  @IsString()
  code?: string;
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  decimals?: number;
}

export class CreateMeterDto {
  @IsString()
  @MinLength(1, { message: 'Bitte einen Namen eingeben' })
  name: string;
  @IsIn(MEDIA, { message: 'Bitte eine Zählerart wählen' })
  medium: (typeof MEDIA)[number];
  /** Leer = Symbol der Zählerart */
  @IsOptional()
  @IsIn(ICONS)
  icon?: (typeof ICONS)[number];
  @IsString()
  @MinLength(1, { message: 'Bitte eine Einheit angeben' })
  unit: string;
  @IsOptional()
  @IsString()
  serialNumber?: string;
  @IsOptional()
  @IsString()
  location?: string;
  @IsOptional()
  @IsString()
  notes?: string;
  @IsOptional()
  @IsString()
  ocrHint?: string;
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  billingStartMonth?: number;
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  billingStartDay?: number;
  @IsOptional()
  @IsInt()
  sortOrder?: number;
  @IsArray()
  @ArrayMinSize(1, { message: 'Ein Zähler braucht mindestens ein Zählwerk' })
  @ValidateNested({ each: true })
  @Type(() => RegisterDto)
  registers: RegisterDto[];
}

export class UpdateMeterDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
  @IsOptional()
  @IsIn(MEDIA)
  medium?: (typeof MEDIA)[number];
  /** null = Symbol der Zählerart */
  @IsOptional()
  @IsIn([...ICONS, null])
  icon?: (typeof ICONS)[number] | null;
  @IsOptional()
  @IsString()
  unit?: string;
  @IsOptional()
  @IsString()
  serialNumber?: string;
  @IsOptional()
  @IsString()
  location?: string;
  @IsOptional()
  @IsString()
  notes?: string;
  @IsOptional()
  @IsString()
  ocrHint?: string;
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  billingStartMonth?: number;
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  billingStartDay?: number;
  @IsOptional()
  @IsInt()
  sortOrder?: number;
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Ein Zähler braucht mindestens ein Zählwerk' })
  @ValidateNested({ each: true })
  @Type(() => RegisterDto)
  registers?: RegisterDto[];
}

export class TariffComponentDto {
  @IsString()
  registerId: string;
  @IsString()
  @MinLength(1)
  label: string;
  @IsNumber()
  @Min(0)
  pricePerUnit: number;
}

export class TariffBonusDto {
  @IsString()
  @MinLength(1)
  label: string;
  @IsNumber()
  @Min(0)
  amount: number;
}

export class TariffDto {
  @IsOptional()
  @IsString()
  name?: string;
  @IsOptional()
  @IsString()
  provider?: string;
  @IsDateString({}, { message: 'Ungültiges Datum' })
  validFrom: string;
  @IsNumber()
  @Min(0)
  basePricePerYear: number;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TariffComponentDto)
  components: TariffComponentDto[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2, { message: 'Höchstens zwei Boni je Tarif' })
  @ValidateNested({ each: true })
  @Type(() => TariffBonusDto)
  bonuses?: TariffBonusDto[];
}

export class AdvancePaymentDto {
  @IsDateString({}, { message: 'Ungültiges Datum' })
  validFrom: string;
  @IsNumber()
  @Min(0)
  amountPerMonth: number;
  @IsOptional()
  @IsString()
  note?: string;
}

export class ExchangeValueDto {
  @IsString()
  registerId: string;
  @IsNumber()
  @Min(0)
  oldFinalValue: number;
  @IsNumber()
  @Min(0)
  newInitialValue: number;
}

export class ExchangeDto {
  @IsDateString({}, { message: 'Ungültiges Datum' })
  exchangedAt: string;
  @IsOptional()
  @IsString()
  newSerialNumber?: string;
  @IsOptional()
  @IsString()
  note?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExchangeValueDto)
  values: ExchangeValueDto[];
}
