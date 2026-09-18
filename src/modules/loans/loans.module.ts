import { Module } from '@nestjs/common';
import { FinancialPeriodsModule } from '@modules/financial-periods/financial-periods.module';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';

@Module({
  imports: [FinancialPeriodsModule],
  controllers: [LoansController],
  providers: [LoansService],
  exports: [LoansService],
})
export class LoansModule {}
