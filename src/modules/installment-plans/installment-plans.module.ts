import { Module } from '@nestjs/common';
import { BudgetsModule } from '@modules/budgets/budgets.module';
import { FinancialPeriodsModule } from '@modules/financial-periods/financial-periods.module';
import { InstallmentPlansController } from './installment-plans.controller';
import { InstallmentPlansService } from './installment-plans.service';

@Module({
  imports: [BudgetsModule, FinancialPeriodsModule],
  controllers: [InstallmentPlansController],
  providers: [InstallmentPlansService],
})
export class InstallmentPlansModule {}
