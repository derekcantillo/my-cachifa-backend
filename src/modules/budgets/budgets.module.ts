import { Module } from '@nestjs/common';
import { AlertsModule } from '@modules/alerts/alerts.module';
import { BudgetRecalculationService } from './budget-recalculation.service';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { IncomeCalculatorService } from './income-calculator.service';

@Module({
  imports: [AlertsModule],
  controllers: [BudgetsController],
  providers: [
    BudgetsService,
    IncomeCalculatorService,
    BudgetRecalculationService,
  ],
  exports: [
    BudgetsService,
    IncomeCalculatorService,
    BudgetRecalculationService,
  ],
})
export class BudgetsModule {}
