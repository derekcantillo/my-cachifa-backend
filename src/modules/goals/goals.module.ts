import { Module } from '@nestjs/common';
import { BudgetsModule } from '@modules/budgets/budgets.module';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';

@Module({
  imports: [BudgetsModule],
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
