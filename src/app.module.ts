import { Module } from '@nestjs/common';
import { AlertsModule } from '@modules/alerts/alerts.module';
import { AnthropicModule } from '@modules/anthropic/anthropic.module';
import { BudgetsModule } from '@modules/budgets/budgets.module';
import { ExpensesModule } from '@modules/expenses/expenses.module';
import { GoalsModule } from '@modules/goals/goals.module';
import { WhatsAppModule } from '@modules/whatsapp/whatsapp.module';

@Module({
  imports: [
    AlertsModule,
    AnthropicModule,
    BudgetsModule,
    ExpensesModule,
    GoalsModule,
    WhatsAppModule,
  ],
})
export class AppModule {}
