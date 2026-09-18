import { Module } from '@nestjs/common';
import { FinancialPeriodsModule } from '@modules/financial-periods/financial-periods.module';
import { IncomeCalculatorService } from './income-calculator.service';
import { PeriodLedgerQueryService } from './period-ledger-query.service';
import { PeriodLedgerController } from './period-ledger.controller';
import { PeriodLedgerService } from './period-ledger.service';

@Module({
  imports: [FinancialPeriodsModule],
  controllers: [PeriodLedgerController],
  providers: [
    IncomeCalculatorService,
    PeriodLedgerService,
    PeriodLedgerQueryService,
  ],
  exports: [IncomeCalculatorService, PeriodLedgerService],
})
export class PeriodLedgerModule {}
