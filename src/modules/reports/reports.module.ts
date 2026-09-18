import { Module } from '@nestjs/common';
import { FinancialPeriodsModule } from '@modules/financial-periods/financial-periods.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [FinancialPeriodsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
