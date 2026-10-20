import { Prisma } from '@prisma/client';

export function num(d: Prisma.Decimal | number | null | undefined): number | null {
  if (d === null || d === undefined) return null;
  return typeof d === 'number' ? d : d.toNumber();
}

export function numOr0(d: Prisma.Decimal | number | null | undefined): number {
  return num(d) ?? 0;
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
