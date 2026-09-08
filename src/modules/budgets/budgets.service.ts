import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrentUserService } from '@common/services/current-user.service';
import { currentMonthYear } from '@common/utils/month.util';
import { PrismaService } from '@modules/prisma/prisma.service';
import { BudgetRecalculationService } from './budget-recalculation.service';
import type { UpsertBudgetsDto } from './dto/upsert-budgets.dto';
import {
  toBudgetResponse,
  type IBudgetResponse,
} from './interfaces/budget-response.interface';

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly budgetRecalculation: BudgetRecalculationService,
  ) {}

  async findAll(month?: string): Promise<IBudgetResponse[]> {
    const userId = await this.currentUser.getUserId();
    return this.listMonth(userId, month ?? currentMonthYear());
  }

  /** Upsert de los límites del mes. Nunca toca `spentAmount`. */
  async upsertMany(
    dto: UpsertBudgetsDto,
    month?: string,
  ): Promise<IBudgetResponse[]> {
    const userId = await this.currentUser.getUserId();
    const monthYear = month ?? currentMonthYear();

    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.budget.upsert({
          where: {
            userId_monthYear_category: {
              userId,
              monthYear,
              category: item.category,
            },
          },
          create: {
            userId,
            monthYear,
            category: item.category,
            limitAmount: new Prisma.Decimal(item.limitAmount),
          },
          update: { limitAmount: new Prisma.Decimal(item.limitAmount) },
        }),
      ),
    );

    return this.listMonth(userId, monthYear);
  }

  /** Reaplica las `BudgetRule` del usuario al mes dado, bajo demanda. */
  async recalculate(month: string): Promise<IBudgetResponse[]> {
    const userId = await this.currentUser.getUserId();

    await this.prisma.$transaction((tx) =>
      this.budgetRecalculation.recalculateBudgets(tx, userId, month),
    );

    return this.listMonth(userId, month);
  }

  async resetSpent(month: string): Promise<IBudgetResponse[]> {
    const userId = await this.currentUser.getUserId();

    await this.prisma.budget.updateMany({
      where: { userId, monthYear: month },
      data: { spentAmount: 0 },
    });

    return this.listMonth(userId, month);
  }

  private async listMonth(
    userId: string,
    monthYear: string,
  ): Promise<IBudgetResponse[]> {
    const budgets = await this.prisma.budget.findMany({
      where: { userId, monthYear },
      orderBy: { category: 'asc' },
    });

    return budgets.map(toBudgetResponse);
  }
}
