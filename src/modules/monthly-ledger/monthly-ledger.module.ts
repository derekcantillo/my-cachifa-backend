import { Module } from '@nestjs/common';
import { IncomeCalculatorService } from './income-calculator.service';
import { MonthlyLedgerQueryService } from './monthly-ledger-query.service';
import { MonthlyLedgerController } from './monthly-ledger.controller';
import { MonthlyLedgerService } from './monthly-ledger.service';

@Module({
  imports: [],
  controllers: [MonthlyLedgerController],
  providers: [
    IncomeCalculatorService,
    MonthlyLedgerService,
    MonthlyLedgerQueryService,
  ],
  exports: [IncomeCalculatorService, MonthlyLedgerService],
})
export class MonthlyLedgerModule {}
