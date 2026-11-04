import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { BalanceAdjustmentsService } from './balance-adjustments.service';

@Module({
  imports: [],
  controllers: [AccountsController],
  providers: [AccountsService, BalanceAdjustmentsService],
  exports: [AccountsService],
})
export class AccountsModule {}
