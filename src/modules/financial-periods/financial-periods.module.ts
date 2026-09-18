import { Module } from '@nestjs/common';
import { FinancialPeriodService } from './financial-period.service';

@Module({
  providers: [FinancialPeriodService],
  exports: [FinancialPeriodService],
})
export class FinancialPeriodsModule {}
