import type { FinancialPeriod, PeriodLedger } from '@prisma/client';

/** Montos como `number` en JSON; en base de datos son `Decimal(14,2)`. */
export interface IPeriodLedgerResponse {
  id: string;
  periodId: string;
  periodLabel: string;
  /** `closingBalance` del período anterior (el rollover). */
  openingBalance: number;
  income: number;
  expenses: number;
  savings: number;
  closingBalance: number;
  /** Lo que queda libre para gastar en el período, rollover incluido. Hoy es igual a `closingBalance`. */
  availableToSpend: number;
  createdAt: string;
  updatedAt: string;
}

export function toPeriodLedgerResponse(
  ledger: PeriodLedger,
  period: FinancialPeriod,
): IPeriodLedgerResponse {
  return {
    id: ledger.id,
    periodId: ledger.periodId,
    periodLabel: period.label,
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
