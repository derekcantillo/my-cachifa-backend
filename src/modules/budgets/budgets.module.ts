import { Module } from '@nestjs/common';
import { AlertsModule } from '@modules/alerts/alerts.module';
import { MonthlyLedgerModule } from '@modules/monthly-ledger/monthly-ledger.module';
import { BudgetRecalculationService } from './budget-recalculation.service';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';

@Module({
  imports: [AlertsModule, MonthlyLedgerModule],
  controllers: [BudgetsController],
  providers: [BudgetsService, BudgetRecalculationService],
  exports: [BudgetsService, BudgetRecalculationService],
})
export class BudgetsModule {}
