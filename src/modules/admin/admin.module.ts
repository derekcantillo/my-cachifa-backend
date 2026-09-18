import { Module } from '@nestjs/common';
import { BudgetsModule } from '@modules/budgets/budgets.module';
import { FinancialPeriodsModule } from '@modules/financial-periods/financial-periods.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [BudgetsModule, FinancialPeriodsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
