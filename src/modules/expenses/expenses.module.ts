import { Module } from '@nestjs/common';
import { FinancialPeriodsModule } from '@modules/financial-periods/financial-periods.module';
import { BudgetsModule } from '@modules/budgets/budgets.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [BudgetsModule, FinancialPeriodsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class ExpensesModule {}
