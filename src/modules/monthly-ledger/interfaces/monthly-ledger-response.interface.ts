import type { MonthlyLedger } from '@prisma/client';

/** Montos como `number` en JSON; en base de datos son `Decimal(14,2)`. */
export interface IMonthlyLedgerResponse {
  id: string;
  month: string;
  /** `closingBalance` del mes anterior (el rollover). */
  openingBalance: number;
  income: number;
  expenses: number;
  savings: number;
  closingBalance: number;
  /** Lo que queda libre para gastar en el mes, rollover incluido. Hoy es igual a `closingBalance`. */
  availableToSpend: number;
  createdAt: string;
  updatedAt: string;
}

export function toMonthlyLedgerResponse(
  ledger: MonthlyLedger,
): IMonthlyLedgerResponse {
  return {
    id: ledger.id,
    month: ledger.month,
    openingBalance: ledger.openingBalance.toNumber(),
    income: ledger.income.toNumber(),
    expenses: ledger.expenses.toNumber(),
    savings: ledger.savings.toNumber(),
    closingBalance: ledger.closingBalance.toNumber(),
    availableToSpend: ledger.closingBalance.toNumber(),
    createdAt: ledger.createdAt.toISOString(),
    updatedAt: ledger.updatedAt.toISOString(),
  };
}
