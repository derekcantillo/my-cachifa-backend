import type { Category, RecurringExpense } from '@prisma/client';

/** El monto viaja como `number` en JSON; en base de datos es `Decimal(12,2)`. */
export interface IRecurringExpenseResponse {
  id: string;
  name: string;
  category: Category;
  estimatedAmount: number;
  isAmountFixed: boolean;
  dayOfMonth: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toRecurringExpenseResponse(
  expense: RecurringExpense,
): IRecurringExpenseResponse {
  return {
    id: expense.id,
    name: expense.name,
    category: expense.category,
    estimatedAmount: expense.estimatedAmount.toNumber(),
    isAmountFixed: expense.isAmountFixed,
    dayOfMonth: expense.dayOfMonth,
    active: expense.active,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
  };
}
