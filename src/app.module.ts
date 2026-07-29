import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import configuration from '@config/configuration';
import { CommonModule } from '@common/common.module';
import { PrismaModule } from '@modules/prisma/prisma.module';
import { AccountsModule } from '@modules/accounts/accounts.module';
import { AlertsModule } from '@modules/alerts/alerts.module';
import { AiModule } from '@modules/ai/ai.module';
import { BudgetsModule } from '@modules/budgets/budgets.module';
import { ExpensesModule } from '@modules/expenses/expenses.module';
import { GoalsModule } from '@modules/goals/goals.module';
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
    PrismaModule,
    CommonModule,
    AccountsModule,
    AlertsModule,
    AiModule,
    BudgetsModule,
    ExpensesModule,
    GoalsModule,
    WhatsAppModule,
  ],
})
export class AppModule {}
