import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as Joi from 'joi';
import configuration from '@config/configuration';
import { CommonModule } from '@common/common.module';
import { PrismaModule } from '@modules/prisma/prisma.module';
import { AccountsModule } from '@modules/accounts/accounts.module';
import { AlertsModule } from '@modules/alerts/alerts.module';
import { AiModule } from '@modules/ai/ai.module';
import { BudgetRulesModule } from '@modules/budget-rules/budget-rules.module';
import { BudgetsModule } from '@modules/budgets/budgets.module';
import { ExpensesModule } from '@modules/expenses/expenses.module';
import { GoalsModule } from '@modules/goals/goals.module';
import { HealthModule } from '@modules/health/health.module';
import { LoansModule } from '@modules/loans/loans.module';
import { RecurringExpensesModule } from '@modules/recurring-expenses/recurring-expenses.module';
import { ReportsModule } from '@modules/reports/reports.module';
import { SettingsModule } from '@modules/settings/settings.module';
import { WhatsAppModule } from '@modules/whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: Joi.object({
        PORT: Joi.number().default(3000),
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        API_KEY: Joi.string().min(32).required(),
        DATABASE_URL: Joi.string().required(),
        WA_PHONE_NUMBER_ID: Joi.string().required(),
        WA_ACCESS_TOKEN: Joi.string().required(),
        WA_VERIFY_TOKEN: Joi.string().required(),
        WA_WEBHOOK_SECRET: Joi.string().required(),
        MY_WA_NUMBER: Joi.string().required(),
        AI_PROVIDER: Joi.string()
          .valid('gemini', 'anthropic')
          .default('gemini'),
        GEMINI_API_KEY: Joi.string().optional().allow(''),
        ANTHROPIC_API_KEY: Joi.string().optional().allow(''),
      }),
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    // 60 requests/minute per IP — generous for a single-user app, low enough to
    // blunt brute-forcing of X-API-Key now that the API is publicly reachable.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    CommonModule,
    AccountsModule,
    AlertsModule,
    AiModule,
    BudgetRulesModule,
    BudgetsModule,
    ExpensesModule,
    GoalsModule,
    HealthModule,
    LoansModule,
    RecurringExpensesModule,
    ReportsModule,
    SettingsModule,
    WhatsAppModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
