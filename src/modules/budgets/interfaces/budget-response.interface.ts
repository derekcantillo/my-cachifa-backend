import { Prisma, type Budget, type Category } from '@prisma/client';

/**
 * Los montos viajan como `number` en JSON (el móvil los consume así); en base
 * de datos siguen siendo `Decimal(12,2)`.
 */
export interface IBudgetResponse {
  id: string;
  monthYear: string;
  category: Category;
  limitAmount: number;
  spentAmount: number;
  /** `spentAmount / limitAmount * 100`, a un decimal. 0 si el límite es 0. */
  percentage: number;
  createdAt: string;
  updatedAt: string;
}

function toPercentage(
  spentAmount: Prisma.Decimal,
  limitAmount: Prisma.Decimal,
): number {
  if (limitAmount.lessThanOrEqualTo(0)) return 0;

  return spentAmount
    .div(limitAmount)
    .times(100)
    .toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function toBudgetResponse(budget: Budget): IBudgetResponse {
  return {
    id: budget.id,
    monthYear: budget.monthYear,
    category: budget.category,
    limitAmount: budget.limitAmount.toNumber(),
    spentAmount: budget.spentAmount.toNumber(),
    percentage: toPercentage(budget.spentAmount, budget.limitAmount),
    createdAt: budget.createdAt.toISOString(),
    updatedAt: budget.updatedAt.toISOString(),
  };
}
