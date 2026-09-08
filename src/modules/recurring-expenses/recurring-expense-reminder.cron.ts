import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AlertType } from '@prisma/client';
import { AlertsService } from '@modules/alerts/alerts.service';
import { formatCOP } from '@common/utils/currency.util';
import { toMonthYear } from '@common/utils/month.util';
import { PrismaService } from '@modules/prisma/prisma.service';

/** Días de aviso antes del vencimiento, inclusive (3, 2, 1, 0 = hoy). */
const REMINDER_WINDOW_DAYS = 3;

/** Último día real del mes que contiene `date`. */
function lastDayOfMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

@Injectable()
export class RecurringExpenseReminderCron {
  private readonly logger = new Logger(RecurringExpenseReminderCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async remindUpcoming(): Promise<void> {
    const today = new Date();
    const month = toMonthYear(today);
    // `dayOfMonth` puede exceder el mes en curso (ej. 31 en un mes de 30);
    // se acota al último día real para no perder el vencimiento.
    const dueDayCeiling = lastDayOfMonth(today);

    const expenses = await this.prisma.recurringExpense.findMany({
      where: { active: true },
    });

    for (const expense of expenses) {
      const dueDay = Math.min(expense.dayOfMonth, dueDayCeiling);
      const daysUntilDue = dueDay - today.getDate();

      if (daysUntilDue < 0 || daysUntilDue > REMINDER_WINDOW_DAYS) continue;

      const alreadyRegistered = await this.prisma.transaction.findFirst({
        where: { recurringExpenseId: expense.id, monthYear: month },
        select: { id: true },
      });

      if (alreadyRegistered) continue;

      await this.alerts.createOnce(
        this.prisma,
        expense.userId,
        AlertType.RECURRING_EXPENSE_DUE,
        `${month}:${expense.id}`,
        `${expense.name}: pago estimado de ${formatCOP(
          expense.estimatedAmount.toNumber(),
        )} vence el día ${expense.dayOfMonth} y todavía no lo registras.`,
      );
    }

    this.logger.log(
      `Recurring expense reminder run for ${month}: ${expenses.length} active expense(s) checked.`,
    );
  }
}
