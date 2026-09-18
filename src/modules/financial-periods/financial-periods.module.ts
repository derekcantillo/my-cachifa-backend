import { Module } from '@nestjs/common';
import { FinancialPeriodService } from './financial-period.service';
import { FinancialPeriodsController } from './financial-periods.controller';

@Module({
  controllers: [FinancialPeriodsController],
  providers: [FinancialPeriodService],
  exports: [FinancialPeriodService],
})
export class FinancialPeriodsModule {}
