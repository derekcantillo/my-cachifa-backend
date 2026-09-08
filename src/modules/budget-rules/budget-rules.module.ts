import { Module } from '@nestjs/common';
import { BudgetRulesController } from './budget-rules.controller';
import { BudgetRulesService } from './budget-rules.service';

@Module({
  imports: [],
  controllers: [BudgetRulesController],
  providers: [BudgetRulesService],
  exports: [BudgetRulesService],
})
export class BudgetRulesModule {}
