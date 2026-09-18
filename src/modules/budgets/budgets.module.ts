import { Module } from '@nestjs/common';
import { AlertsModule } from '@modules/alerts/alerts.module';
import { FinancialPeriodsModule } from '@modules/financial-periods/financial-periods.module';
import { PeriodLedgerModule } from '@modules/period-ledger/period-ledger.module';
import { BudgetRecalculationService } from './budget-recalculation.service';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';

@Module({
  imports: [AlertsModule, FinancialPeriodsModule, PeriodLedgerModule],
  controllers: [BudgetsController],
  providers: [BudgetsService, BudgetRecalculationService],
  exports: [BudgetsService, BudgetRecalculationService],
})
export class BudgetsModule {}
