import { Injectable } from '@nestjs/common';
import {
  AlertType,
  GoalStatus,
  Prisma,
  type Category,
  type Goal,
} from '@prisma/client';
import { AlertsService } from '@modules/alerts/alerts.service';
import { formatCOP } from '@common/utils/currency.util';
import { monthsBetween, toMonthYearUTC } from '@common/utils/month.util';
import { IncomeCalculatorService } from './income-calculator.service';

/** Piso de meses restantes para una meta, evita dividir por cero cuando el mes objetivo ya llegó o pasó. */
const MIN_MONTHS_REMAINING = 1;

@Injectable()
export class BudgetRecalculationService {
  constructor(
    private readonly incomeCalculator: IncomeCalculatorService,
    private readonly alerts: AlertsService,
  ) {}

  /**
   * a. Ingreso efectivo del mes.
   * b-c. Se le restan los compromisos fijos (`RecurringExpense` activos) ->
   *      ingreso disponible; puede quedar negativo a propósito, para que la
   *      UI pueda alertar que los fijos ya superan el ingreso.
   * d. Cada `RecurringExpense` activo fija `Budget.limitAmount` en su
   *    `estimatedAmount`, con precedencia sobre cualquier `BudgetRule` de la
   *    misma categoría.
   * e. El resto de categorías con `BudgetRule` se derivan del disponible.
   * f-h. Si el aporte que exigen las metas activas supera el ahorro
   *      recomendado, se registra una alerta (una por mes).
   */
  async recalculateBudgets(
    client: Prisma.TransactionClient,
    userId: string,
    month: string,
  ): Promise<void> {
    const [effectiveIncome, recurringExpenses, rules, goals, user] =
      await Promise.all([
        this.incomeCalculator.getEffectiveIncome(client, userId, month),
        client.recurringExpense.findMany({ where: { userId, active: true } }),
        client.budgetRule.findMany({ where: { userId } }),
        client.goal.findMany({ where: { userId, status: GoalStatus.ACTIVE } }),
        client.user.findUniqueOrThrow({ where: { id: userId } }),
      ]);

    const fixedCommitments = recurringExpenses.reduce(
      (sum, expense) => sum.plus(expense.estimatedAmount),
      new Prisma.Decimal(0),
    );
    const discretionaryIncome = effectiveIncome.minus(fixedCommitments);
    const fixedCategories = new Set(
      recurringExpenses.map((expense) => expense.category),
    );

    await Promise.all(
      recurringExpenses.map((expense) =>
        this.upsertLimit(
          client,
          userId,
          month,
          expense.category,
          expense.estimatedAmount,
        ),
      ),
    );

    await Promise.all(
      rules
        .filter((rule) => !fixedCategories.has(rule.category))
        .map((rule) =>
          this.upsertLimit(
            client,
            userId,
            month,
            rule.category,
            discretionaryIncome.times(rule.targetPercentage).div(100),
          ),
        ),
    );

    await this.checkSavingsTarget(
      client,
      userId,
      month,
      discretionaryIncome,
      goals,
      user.targetSavingsPercentage,
    );
  }

  private async upsertLimit(
    client: Prisma.TransactionClient,
    userId: string,
    month: string,
    category: Category,
    limitAmount: Prisma.Decimal,
  ): Promise<void> {
    const rounded = limitAmount.toDecimalPlaces(
      2,
      Prisma.Decimal.ROUND_HALF_UP,
    );

    await client.budget.upsert({
      where: {
        userId_monthYear_category: { userId, monthYear: month, category },
      },
      create: { userId, monthYear: month, category, limitAmount: rounded },
      update: { limitAmount: rounded },
    });
  }

  /** Aporte mensual que exigen las metas activas, vs. el pool de ahorro recomendado. */
  private async checkSavingsTarget(
    client: Prisma.TransactionClient,
    userId: string,
    month: string,
    discretionaryIncome: Prisma.Decimal,
    goals: readonly Goal[],
    targetSavingsPercentage: Prisma.Decimal,
  ): Promise<void> {
    const requiredContribution = goals.reduce((total, goal) => {
      const remaining = goal.targetAmount.minus(goal.currentAmount);
      if (remaining.lessThanOrEqualTo(0)) return total;

      const monthsRemaining = Math.max(
        MIN_MONTHS_REMAINING,
        monthsBetween(month, toMonthYearUTC(goal.targetDate)),
      );

      return total.plus(remaining.div(monthsRemaining));
    }, new Prisma.Decimal(0));

    const recommendedPool = discretionaryIncome
      .times(targetSavingsPercentage)
      .div(100);

    if (requiredContribution.lessThanOrEqualTo(recommendedPool)) return;

    await this.alerts.createOnce(
      client,
      userId,
      AlertType.SAVINGS_TARGET_AT_RISK,
      month,
      `Tus metas activas requieren un aporte de ${formatCOP(
        requiredContribution.toNumber(),
      )}/mes, pero tu ahorro recomendado (${targetSavingsPercentage.toNumber()}% ` +
        `del disponible) es de ${formatCOP(recommendedPool.toNumber())}. Revisa tus metas o tu meta de ahorro.`,
    );
  }
}
