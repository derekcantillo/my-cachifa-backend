import { Prisma } from '@prisma/client';

/**
 * `value / base * 100`, a un decimal. 0 si `base` es <= 0. Mismo criterio de
 * redondeo usado por `Budget.percentage` (Sub-bloque 8a).
 */
export function toPercentage(
  value: Prisma.Decimal,
  base: Prisma.Decimal,
): number {
  if (base.lessThanOrEqualTo(0)) return 0;

  return value
    .div(base)
    .times(100)
    .toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}
