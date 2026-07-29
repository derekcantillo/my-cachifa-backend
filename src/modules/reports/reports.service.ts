import { Injectable } from '@nestjs/common';
import { Category, GoalStatus, Prisma, TransactionType } from '@prisma/client';
import { CurrentUserService } from '@common/services/current-user.service';
import { currentMonthYear } from '@common/utils/month.util';
import { toPercentage } from '@common/utils/percentage.util';
import { PrismaService } from '@modules/prisma/prisma.service';
import type {
  IDistributionItem,
  IReportSummary,
  ISavingsProjection,
} from './interfaces/report-response.interface';

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async getSummary(month?: string): Promise<IReportSummary> {
    const userId = await this.currentUser.getUserId();
    const monthYear = month ?? currentMonthYear();

    const [biggestExpenseGroup, savingsSum, savingsBudget, frequentGroup] =
      await Promise.all([
        this.prisma.transaction.groupBy({
          by: ['category'],
          where: { userId, monthYear, type: TransactionType.EXPENSE },
          _sum: { amount: true },
          orderBy: { _sum: { amount: 'desc' } },
          take: 1,
        }),
        this.prisma.transaction.aggregate({
          where: { userId, monthYear, type: TransactionType.SAVING },
          _sum: { amount: true },
        }),
        this.prisma.budget.findUnique({
          where: {
            userId_monthYear_category: {
              userId,
              monthYear,
              category: Category.SAVING,
            },
          },
        }),
        this.prisma.transaction.groupBy({
          by: ['category'],
          where: { userId, monthYear },
          _count: { category: true },
          orderBy: { _count: { category: 'desc' } },
          take: 1,
        }),
      ]);

    const biggestExpense = biggestExpenseGroup[0]
      ? {
          category: biggestExpenseGroup[0].category,
          amount: (biggestExpenseGroup[0]._sum.amount ?? ZERO).toNumber(),
        }
      : null;

    const actual = savingsSum._sum.amount ?? ZERO;
    const planned = savingsBudget?.limitAmount ?? ZERO;

    const mostFrequentCategory = frequentGroup[0]
      ? {
          category: frequentGroup[0].category,
          count: frequentGroup[0]._count.category,
        }
      : null;

    return {
      biggestExpense,
      savingsProgress: {
        actual: actual.toNumber(),
        planned: planned.toNumber(),
        percentage: toPercentage(actual, planned),
      },
      mostFrequentCategory,
    };
  }

  async getDistribution(month?: string): Promise<IDistributionItem[]> {
    const userId = await this.currentUser.getUserId();
    const monthYear = month ?? currentMonthYear();

    const grouped = await this.prisma.transaction.groupBy({
      by: ['category'],
      where: { userId, monthYear, type: TransactionType.EXPENSE },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
    });

    const total = grouped.reduce(
      (sum, group) => sum.add(group._sum.amount ?? ZERO),
      ZERO,
    );

    return grouped.map((group) => {
      const amount = group._sum.amount ?? ZERO;
      return {
        category: group.category,
        amount: amount.toNumber(),
        percentage: toPercentage(amount, total),
      };
    });
  }

  async getSavingsProjection(): Promise<ISavingsProjection> {
    const userId = await this.currentUser.getUserId();

    const [contributions, activeGoals] = await Promise.all([
      this.prisma.goalContribution.findMany({
        where: { goal: { userId, status: GoalStatus.ACTIVE } },
        orderBy: { contributedAt: 'asc' },
        select: { amount: true, contributedAt: true },
      }),
      this.prisma.goal.findMany({
        where: { userId, status: GoalStatus.ACTIVE },
        select: { name: true, targetDate: true },
        orderBy: { targetDate: 'asc' },
      }),
    ]);

    let running = ZERO;
    const points = contributions.map((contribution) => {
      running = running.add(contribution.amount);
      return {
        date: contribution.contributedAt.toISOString(),
        cumulativeAmount: running.toNumber(),
      };
    });

    const markers = activeGoals.map((goal) => ({
      date: goal.targetDate.toISOString(),
      label: goal.name,
    }));

    return { points, markers };
  }
}
