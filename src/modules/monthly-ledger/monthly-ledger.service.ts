import { Injectable } from '@nestjs/common';
import { Prisma, TransactionType, type MonthlyLedger } from '@prisma/client';
import { monthBounds, shiftMonth } from '@common/utils/month.util';
import { IncomeCalculatorService } from './income-calculator.service';

const ZERO = new Prisma.Decimal(0);

/**
 * Tipos que salen del disponible del mes como gasto. `LOAN_GIVEN` queda
 * fuera a propósito: es dinero por cobrar (activo), no gastado.
 */
const EXPENSE_TYPES: TransactionType[] = [
  TransactionType.EXPENSE,
  TransactionType.DEBT_PAYMENT,
];

@Injectable()
export class MonthlyLedgerService {
  constructor(private readonly incomeCalculator: IncomeCalculatorService) {}

  /**
   * Recalcula un solo mes, tomando como `openingBalance` el `closingBalance`
   * del `MonthlyLedger` del mes anterior (0 si no existe). No toca los meses
   * siguientes — para eso está `recalculateLedgerCascade`.
   */
  async recalculateLedger(
    client: Prisma.TransactionClient,
    userId: string,
    month: string,
  ): Promise<MonthlyLedger> {
    const openingBalance = await this.getPreviousClosing(client, userId, month);
    return this.computeAndUpsert(client, userId, month, openingBalance);
  }

  /**
   * Recalcula `fromMonth` y cada mes siguiente hasta el último que ya tenga
   * ledger (o hasta `throughMonth`, si es posterior), en orden y sin huecos:
   * el `closingBalance` de cada mes es el `openingBalance` del siguiente, así
   * que un cambio retroactivo tiene que propagarse hacia adelante. Los meses
   * intermedios sin ledger se crean para que la cadena no se corte.
   */
  async recalculateLedgerCascade(
    client: Prisma.TransactionClient,
    userId: string,
    fromMonth: string,
    throughMonth: string = fromMonth,
  ): Promise<MonthlyLedger[]> {
    const start = fromMonth < throughMonth ? fromMonth : throughMonth;
    const latest = await client.monthlyLedger.findFirst({
      where: { userId, month: { gt: start } },
      orderBy: { month: 'desc' },
      select: { month: true },
    });
    const end = [fromMonth, throughMonth, latest?.month ?? start].reduce(
      (max, month) => (month > max ? month : max),
    );

    const ledgers: MonthlyLedger[] = [];
    let openingBalance = await this.getPreviousClosing(client, userId, start);

    for (let month = start; month <= end; month = shiftMonth(month, 1)) {
      const ledger = await this.computeAndUpsert(
        client,
        userId,
        month,
        openingBalance,
      );
      ledgers.push(ledger);
      openingBalance = ledger.closingBalance;
    }

    return ledgers;
  }

  /**
   * El ledger del mes tal como está guardado; si aún no existe, se construye
   * encadenándolo desde el último mes anterior que sí tenga uno, para no
   * arrancar un mes suelto con `openingBalance` en 0.
   */
  async getOrBuildLedger(
    client: Prisma.TransactionClient,
    userId: string,
    month: string,
  ): Promise<MonthlyLedger> {
    const existing = await client.monthlyLedger.findUnique({
      where: { userId_month: { userId, month } },
    });
    if (existing) return existing;

    const previous = await client.monthlyLedger.findFirst({
      where: { userId, month: { lt: month } },
      orderBy: { month: 'desc' },
      select: { month: true },
    });
    const fromMonth = previous ? shiftMonth(previous.month, 1) : month;

    await this.recalculateLedgerCascade(client, userId, fromMonth, month);
    return client.monthlyLedger.findUniqueOrThrow({
      where: { userId_month: { userId, month } },
    });
  }

  private async getPreviousClosing(
    client: Prisma.TransactionClient,
    userId: string,
    month: string,
  ): Promise<Prisma.Decimal> {
    const previous = await client.monthlyLedger.findUnique({
      where: { userId_month: { userId, month: shiftMonth(month, -1) } },
      select: { closingBalance: true },
    });
    return previous?.closingBalance ?? ZERO;
  }

  private async computeAndUpsert(
    client: Prisma.TransactionClient,
    userId: string,
    month: string,
    openingBalance: Prisma.Decimal,
  ): Promise<MonthlyLedger> {
    const { start, end } = monthBounds(month);

    const [income, expenses, savings] = await Promise.all([
      this.incomeCalculator.getEffectiveIncome(client, userId, month),
      client.transaction.aggregate({
        where: { userId, monthYear: month, type: { in: EXPENSE_TYPES } },
        _sum: { amount: true },
      }),
      client.goalContribution.aggregate({
        where: { goal: { userId }, contributedAt: { gte: start, lt: end } },
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

    return client.monthlyLedger.upsert({
      where: { userId_month: { userId, month } },
      create: { userId, month, ...data },
      update: data,
    });
  }
}
