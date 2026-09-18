import { Injectable } from '@nestjs/common';
import {
  AlertType,
  GoalStatus,
  Prisma,
  TransactionType,
  type Category,
  type FinancialPeriod,
  type Goal,
  type PeriodLedger,
} from '@prisma/client';
import { AlertsService } from '@modules/alerts/alerts.service';
import { formatCOP } from '@common/utils/currency.util';
import {
  monthsBetween,
  toMonthYear,
  toMonthYearUTC,
} from '@common/utils/month.util';
import { FinancialPeriodService } from '@modules/financial-periods/financial-period.service';
import { PeriodLedgerService } from '@modules/period-ledger/period-ledger.service';

const ZERO = new Prisma.Decimal(0);

/** Piso de meses restantes para una meta, evita dividir por cero cuando el mes objetivo ya llegó o pasó. */
const MIN_MONTHS_REMAINING = 1;

/** Solo estos tipos consumen presupuesto. */
const BUDGET_AFFECTING_TYPES: TransactionType[] = [
  TransactionType.EXPENSE,
  TransactionType.DEBT_PAYMENT,
];

@Injectable()
export class BudgetRecalculationService {
  constructor(
    private readonly periodLedger: PeriodLedgerService,
    private readonly financialPeriods: FinancialPeriodService,
    private readonly alerts: AlertsService,
  ) {}

  /**
   * Punto de entrada tras cualquier mutación que mueva dinero: recalcula en
   * cascada los `PeriodLedger` desde el período que contiene `from` y luego
   * los presupuestos de cada uno de esos períodos — su `openingBalance` (el
   * rollover) y su gasto pudieron cambiar.
   */
  async recalculateFrom(
    client: Prisma.TransactionClient,
    userId: string,
    from: Date,
  ): Promise<void> {
    const ledgers = await this.periodLedger.recalculateLedgerCascade(
      client,
      userId,
      from,
    );

    for (const ledger of ledgers) {
      await this.recalculateBudgets(client, userId, ledger.period, ledger);
    }
  }

  /** Recalcula los presupuestos del período actual (ej. tras cambiar un gasto fijo). */
  async recalculateCurrentPeriod(
    client: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    const period = await this.financialPeriods.getCurrentPeriod(client, userId);
    await this.recalculateBudgets(client, userId, period);
  }

  /**
   * a. Base del período = `openingBalance` (rollover) + ingreso del período
   *    − compromisos fijos (`RecurringExpense` activos). El gasto ya
   *    ejecutado NO la reduce: por eso nunca se usa `closingBalance`.
   * b. Cada categoría con `RecurringExpense` activo fija su límite en la
   *    suma de sus `estimatedAmount` (ej. HOUSING = arriendo + servicios),
   *    con precedencia sobre cualquier `BudgetRule` de la misma categoría.
   * c. El resto de categorías con `BudgetRule` = max(0, base) × porcentaje.
   *    Si la base es negativa (arrastre de déficit) esos límites quedan en 0
   *    y, en el período en curso, se registra una alerta `PERIOD_DEFICIT`.
   * d. `spentAmount` se recalcula de las transacciones del período.
   * e. En el período en curso, si el aporte que exigen las metas activas
   *    supera el ahorro recomendado, se registra una alerta (una por período).
   */
  async recalculateBudgets(
    client: Prisma.TransactionClient,
    userId: string,
    period: FinancialPeriod,
    ledger?: PeriodLedger,
  ): Promise<void> {
    const [periodLedger, recurringExpenses, rules, goals, user] =
      await Promise.all([
        ledger ?? this.periodLedger.getOrBuildLedger(client, userId, period),
        client.recurringExpense.findMany({ where: { userId, active: true } }),
        client.budgetRule.findMany({ where: { userId } }),
        client.goal.findMany({ where: { userId, status: GoalStatus.ACTIVE } }),
        client.user.findUniqueOrThrow({ where: { id: userId } }),
      ]);

    const fixedByCategory = new Map<Category, Prisma.Decimal>();
    for (const expense of recurringExpenses) {
      fixedByCategory.set(
        expense.category,
        (fixedByCategory.get(expense.category) ?? ZERO).plus(
          expense.estimatedAmount,
        ),
      );
    }
    const fixedCommitments = [...fixedByCategory.values()].reduce(
      (sum, amount) => sum.plus(amount),
      ZERO,
    );

    const budgetBase = periodLedger.openingBalance
      .plus(periodLedger.income)
      .minus(fixedCommitments);
    const distributable = Prisma.Decimal.max(ZERO, budgetBase);

    const limits = new Map<Category, Prisma.Decimal>(fixedByCategory);
    for (const rule of rules) {
      if (limits.has(rule.category)) continue;
      limits.set(
        rule.category,
        distributable.times(rule.targetPercentage).div(100),
      );
    }

    for (const [category, limitAmount] of limits) {
      const rounded = limitAmount.toDecimalPlaces(
        2,
        Prisma.Decimal.ROUND_HALF_UP,
      );
      await client.budget.upsert({
        where: {
          userId_periodId_category: { userId, periodId: period.id, category },
        },
        create: { userId, periodId: period.id, category, limitAmount: rounded },
        update: { limitAmount: rounded },
      });
    }

    await this.syncSpent(client, userId, period.id);

    // Las alertas solo tienen sentido para el período en curso: recalcular
    // uno cerrado (o el de arranque, que por definición no tiene salario) no
    // debe avisar de algo que ya no se puede corregir.
    if (period.endDate !== null) return;

    if (budgetBase.lessThan(0)) {
      await this.alerts.createOnce(
        client,
        userId,
        AlertType.PERIOD_DEFICIT,
        period.id,
        `El período ${period.label} arranca en déficit: saldo anterior más ` +
          `ingresos menos gastos fijos da ${formatCOP(budgetBase.toNumber())}. ` +
          `Los presupuestos por porcentaje quedan en $ 0 hasta cubrirlo.`,
      );
    }

    await this.checkSavingsTarget(
      client,
      userId,
      period,
      distributable,
      goals,
      user.targetSavingsPercentage,
    );
  }

  /**
   * `spentAmount` de cada categoría = suma de sus EXPENSE/DEBT_PAYMENT del
   * período. Crea con límite 0 las categorías con gasto sin presupuesto, y
   * pone en 0 las que ya no tienen gasto.
   */
  async syncSpent(
    client: Prisma.TransactionClient,
    userId: string,
    periodId: string,
  ): Promise<void> {
    const spent = await client.transaction.groupBy({
      by: ['category'],
      where: { userId, periodId, type: { in: BUDGET_AFFECTING_TYPES } },
      _sum: { amount: true },
    });

    for (const group of spent) {
      const spentAmount = group._sum.amount ?? ZERO;
      await client.budget.upsert({
        where: {
          userId_periodId_category: {
            userId,
            periodId,
            category: group.category,
          },
        },
        create: {
          userId,
          periodId,
          category: group.category,
          limitAmount: 0,
          spentAmount,
        },
        update: { spentAmount },
      });
    }

    await client.budget.updateMany({
      where: {
        userId,
        periodId,
        category: { notIn: spent.map((group) => group.category) },
      },
      data: { spentAmount: 0 },
    });
  }

  /** Aporte mensual que exigen las metas activas, vs. el pool de ahorro recomendado. */
  private async checkSavingsTarget(
    client: Prisma.TransactionClient,
    userId: string,
    period: FinancialPeriod,
    distributable: Prisma.Decimal,
    goals: readonly Goal[],
    targetSavingsPercentage: Prisma.Decimal,
  ): Promise<void> {
    const periodMonth = toMonthYear(period.startDate);
    const requiredContribution = goals.reduce((total, goal) => {
      const remaining = goal.targetAmount.minus(goal.currentAmount);
      if (remaining.lessThanOrEqualTo(0)) return total;

      const monthsRemaining = Math.max(
        MIN_MONTHS_REMAINING,
        monthsBetween(periodMonth, toMonthYearUTC(goal.targetDate)),
      );

      return total.plus(remaining.div(monthsRemaining));
    }, ZERO);

    if (requiredContribution.lessThanOrEqualTo(0)) return;

    const recommendedPool = distributable
      .times(targetSavingsPercentage)
      .div(100);

    if (requiredContribution.lessThanOrEqualTo(recommendedPool)) return;

    await this.alerts.createOnce(
      client,
      userId,
      AlertType.SAVINGS_TARGET_AT_RISK,
      period.id,
      `Tus metas activas requieren un aporte de ${formatCOP(
        requiredContribution.toNumber(),
      )}/mes, pero tu ahorro recomendado (${targetSavingsPercentage.toNumber()}% ` +
        `del disponible) es de ${formatCOP(recommendedPool.toNumber())}. Revisa tus metas o tu meta de ahorro.`,
    );
  }
}
