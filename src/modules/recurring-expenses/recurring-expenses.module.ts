import { Module } from '@nestjs/common';
import { AlertsModule } from '@modules/alerts/alerts.module';
import { BudgetsModule } from '@modules/budgets/budgets.module';
import { RecurringExpenseReminderCron } from './recurring-expense-reminder.cron';
import { RecurringExpensesController } from './recurring-expenses.controller';
import { RecurringExpensesService } from './recurring-expenses.service';

@Module({
  imports: [BudgetsModule, AlertsModule],
  controllers: [RecurringExpensesController],
  providers: [RecurringExpensesService, RecurringExpenseReminderCron],
  exports: [RecurringExpensesService],
})
export class RecurringExpensesModule {}
