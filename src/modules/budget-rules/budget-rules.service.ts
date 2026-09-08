import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrentUserService } from '@common/services/current-user.service';
import { PrismaService } from '@modules/prisma/prisma.service';
import type { UpsertBudgetRulesDto } from './dto/upsert-budget-rules.dto';
import {
  toBudgetRuleResponse,
  type IBudgetRuleResponse,
  type IUpsertBudgetRulesResponse,
} from './interfaces/budget-rule-response.interface';

const PERCENTAGE_OVER_100_WARNING = (total: number): string =>
  `Las reglas suman ${total}% del ingreso, más de 100%.`;

@Injectable()
export class BudgetRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async findAll(): Promise<IBudgetRuleResponse[]> {
    const userId = await this.currentUser.getUserId();
    return this.listRules(userId);
  }

  /**
   * Upsert de cada regla por (userId, category). No dispara recálculo de
   * `Budget` — eso es explícito vía `POST /budgets/:month/recalculate`, para
   * que ajustar reglas no reescriba de golpe todos los meses ya existentes.
   */
  async upsertMany(
    dto: UpsertBudgetRulesDto,
  ): Promise<IUpsertBudgetRulesResponse> {
    const userId = await this.currentUser.getUserId();

    await this.prisma.$transaction(
      dto.rules.map((item) =>
        this.prisma.budgetRule.upsert({
          where: { userId_category: { userId, category: item.category } },
          create: {
            userId,
            category: item.category,
            targetPercentage: new Prisma.Decimal(item.targetPercentage),
          },
          update: {
            targetPercentage: new Prisma.Decimal(item.targetPercentage),
          },
        }),
      ),
    );

    const rules = await this.listRules(userId);
    const totalPercentage = this.sumPercentages(rules);

    return {
      rules,
      totalPercentage,
      warning:
        totalPercentage > 100
          ? PERCENTAGE_OVER_100_WARNING(totalPercentage)
          : null,
    };
  }

  private async listRules(userId: string): Promise<IBudgetRuleResponse[]> {
    const rules = await this.prisma.budgetRule.findMany({
      where: { userId },
      orderBy: { category: 'asc' },
    });

    return rules.map(toBudgetRuleResponse);
  }

  /** Suma redondeada a 2 decimales, para no arrastrar ruido de punto flotante. */
  private sumPercentages(rules: readonly IBudgetRuleResponse[]): number {
    const total = rules.reduce((sum, rule) => sum + rule.targetPercentage, 0);
    return Math.round(total * 100) / 100;
  }
}
