import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AlertType } from '@prisma/client';
import { AlertsService } from '@modules/alerts/alerts.service';
import { formatCOP } from '@common/utils/currency.util';
import {
  daysInMonth,
  toFinancialCalendarDate,
} from '@common/utils/period.util';
import { FinancialPeriodService } from '@modules/financial-periods/financial-period.service';
import { PrismaService } from '@modules/prisma/prisma.service';

/** Días de aviso antes del vencimiento, inclusive (3, 2, 1, 0 = hoy). */
const REMINDER_WINDOW_DAYS = 3;

@Injectable()
export class RecurringExpenseReminderCron {
  private readonly logger = new Logger(RecurringExpenseReminderCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly financialPeriods: FinancialPeriodService,
  ) {}

  // El contenedor corre en UTC: sin `timeZone` las 8am serían las 3am en Bogotá.
  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: 'America/Bogota' })
  async remindUpcoming(): Promise<void> {
    // `dayOfMonth` es un día del calendario de Bogotá; se acota al último día
    // real del mes (ej. 31 en un mes de 30) para no perder el vencimiento.
    const today = toFinancialCalendarDate(new Date());
    const dueDayCeiling = daysInMonth(today.year, today.month);

    const expenses = await this.prisma.recurringExpense.findMany({
      where: { active: true },
    });

    for (const expense of expenses) {
      const dueDay = Math.min(expense.dayOfMonth, dueDayCeiling);
      const daysUntilDue = dueDay - today.day;

      if (daysUntilDue < 0 || daysUntilDue > REMINDER_WINDOW_DAYS) continue;

      // "Ya registrado" = pagado dentro del período financiero actual.
      const period = await this.financialPeriods.getCurrentPeriod(
        this.prisma,
        expense.userId,
      );
      const alreadyRegistered = await this.prisma.transaction.findFirst({
        where: { recurringExpenseId: expense.id, periodId: period.id },
        select: { id: true },
      });

      if (alreadyRegistered) continue;

      await this.alerts.createOnce(
        this.prisma,
        expense.userId,
        AlertType.RECURRING_EXPENSE_DUE,
        `${period.id}:${expense.id}`,
        `${expense.name}: pago estimado de ${formatCOP(
          expense.estimatedAmount.toNumber(),
        )} vence el día ${expense.dayOfMonth} y todavía no lo registras.`,
      );
    }

    this.logger.log(
      `Recurring expense reminder run for ${today.year}-${today.month}-${today.day} (Bogotá): ${expenses.length} active expense(s) checked.`,
    );
  }
}
