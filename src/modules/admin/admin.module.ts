import { Module } from '@nestjs/common';
import { FinancialPeriodsModule } from '@modules/financial-periods/financial-periods.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [FinancialPeriodsModule],
  controllers: [AdminController],
})
export class AdminModule {}
