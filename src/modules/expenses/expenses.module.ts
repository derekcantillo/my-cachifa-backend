import { Module } from '@nestjs/common';
import { BudgetsModule } from '@modules/budgets/budgets.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [BudgetsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class ExpensesModule {}
