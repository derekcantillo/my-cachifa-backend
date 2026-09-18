import { Injectable } from '@nestjs/common';
import {
  Prisma,
  TransactionType,
  type FinancialPeriod,
  type PeriodLedger,
} from '@prisma/client';
import { IncomeCalculatorService } from './income-calculator.service';

const ZERO = new Prisma.Decimal(0);

/**
 * Tipos que salen del disponible del período como gasto. `LOAN_GIVEN` queda
 * fuera a propósito: es dinero por cobrar (activo), no gastado.
 */
const EXPENSE_TYPES: TransactionType[] = [
  TransactionType.EXPENSE,
  TransactionType.DEBT_PAYMENT,
];

export type PeriodLedgerWithPeriod = PeriodLedger & { period: FinancialPeriod };

@Injectable()
export class PeriodLedgerService {
  constructor(private readonly incomeCalculator: IncomeCalculatorService) {}

  /**
   * Recalcula el período que contiene `from` (o el primero, si `from` es
   * anterior a todos) y cada período siguiente, en orden de `startDate`: el
   * `closingBalance` de cada uno es el `openingBalance` del siguiente, así
   * que un cambio retroactivo tiene que propagarse hacia adelante. Si algún
   * período anterior aún no tiene ledger, la cascada arranca desde él para
   * que la cadena no se corte.
   */
  async recalculateLedgerCascade(
    client: Prisma.TransactionClient,
    userId: string,
    from: Date,
  ): Promise<PeriodLedgerWithPeriod[]> {
    const [periods, existing] = await Promise.all([
      client.financialPeriod.findMany({
        where: { userId },
        orderBy: { startDate: 'asc' },
      }),
      client.periodLedger.findMany({
        where: { userId },
        select: { periodId: true, closingBalance: true },
      }),
    ]);
    const closingByPeriod = new Map(
      existing.map((ledger) => [ledger.periodId, ledger.closingBalance]),
    );

    let startIndex = 0;
    periods.forEach((period, index) => {
      if (period.startDate <= from) startIndex = index;
    });
    while (
      startIndex > 0 &&
      !closingByPeriod.has(periods[startIndex - 1]?.id ?? '')
    ) {
      startIndex -= 1;
    }

    const previous = periods[startIndex - 1];
    let openingBalance = (previous && closingByPeriod.get(previous.id)) ?? ZERO;
    const ledgers: PeriodLedgerWithPeriod[] = [];

    for (const period of periods.slice(startIndex)) {
      const ledger = await this.computeAndUpsert(
        client,
        userId,
        period,
        openingBalance,
      );
      ledgers.push({ ...ledger, period });
      openingBalance = ledger.closingBalance;
    }

    return ledgers;
  }

  /**
   * El ledger del período tal como está guardado; si aún no existe, se
   * construye con la cascada (que rellena también los períodos anteriores
   * que falten) para no arrancarlo con `openingBalance` en 0.
   */
  async getOrBuildLedger(
    client: Prisma.TransactionClient,
    userId: string,
    period: FinancialPeriod,
  ): Promise<PeriodLedger> {
    const existing = await client.periodLedger.findUnique({
      where: { userId_periodId: { userId, periodId: period.id } },
    });
    if (existing) return existing;

    await this.recalculateLedgerCascade(client, userId, period.startDate);
    return client.periodLedger.findUniqueOrThrow({
      where: { userId_periodId: { userId, periodId: period.id } },
    });
  }

  private async computeAndUpsert(
    client: Prisma.TransactionClient,
    userId: string,
    period: FinancialPeriod,
    openingBalance: Prisma.Decimal,
  ): Promise<PeriodLedger> {
    const [income, expenses, savings] = await Promise.all([
      this.incomeCalculator.getEffectiveIncome(client, userId, period.id),
      client.transaction.aggregate({
        where: {
          userId,
          periodId: period.id,
          type: { in: EXPENSE_TYPES },
        },
        _sum: { amount: true },
      }),
      // Los aportes a metas no son transacciones: caen en el período por
      // fecha, con el mismo rango `[startDate, endDate)`.
      client.goalContribution.aggregate({
        where: {
          goal: { userId },
          contributedAt: {
            gte: period.startDate,
            ...(period.endDate ? { lt: period.endDate } : {}),
          },
        },
        _sum: { amount: true },
      }),
    ]);

    const expensesTotal = expenses._sum.amount ?? ZERO;
    const savingsTotal = savings._sum.amount ?? ZERO;
    const closingBalance = openingBalance
      .plus(income)
      .minus(expensesTotal)
      .minus(savingsTotal);
    const data = {
      openingBalance,
      income,
      expenses: expensesTotal,
      savings: savingsTotal,
      closingBalance,
    };

    return client.periodLedger.upsert({
      where: { userId_periodId: { userId, periodId: period.id } },
      create: { userId, periodId: period.id, ...data },
      update: data,
    });
  }
}
