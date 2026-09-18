import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type RecurringExpense } from '@prisma/client';
import { BudgetRecalculationService } from '@modules/budgets/budget-recalculation.service';
import { CurrentUserService } from '@common/services/current-user.service';
import { FinancialPeriodService } from '@modules/financial-periods/financial-period.service';
import { CASCADE_TRANSACTION_OPTIONS } from '@modules/period-ledger/period-ledger.constants';
import { PrismaService } from '@modules/prisma/prisma.service';
import type { CreateRecurringExpenseDto } from './dto/create-recurring-expense.dto';
import type { UpdateRecurringExpenseDto } from './dto/update-recurring-expense.dto';
import {
  toRecurringExpenseResponse,
  type IRecurringExpenseResponse,
} from './interfaces/recurring-expense-response.interface';

@Injectable()
export class RecurringExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly budgetRecalculation: BudgetRecalculationService,
    private readonly financialPeriods: FinancialPeriodService,
  ) {}

  async findAll(): Promise<IRecurringExpenseResponse[]> {
    const userId = await this.currentUser.getUserId();

    const expenses = await this.prisma.recurringExpense.findMany({
      where: { userId },
      orderBy: { dayOfMonth: 'asc' },
    });

    return expenses.map(toRecurringExpenseResponse);
  }

  /** Activos sin una `Transaction` del período todavía enlazada. */
  async findPending(periodId?: string): Promise<IRecurringExpenseResponse[]> {
    const userId = await this.currentUser.getUserId();
    const period = await this.financialPeriods.resolvePeriod(
      this.prisma,
      userId,
      periodId,
    );

    const expenses = await this.prisma.recurringExpense.findMany({
      where: {
        userId,
        active: true,
        transactions: { none: { periodId: period.id } },
      },
      orderBy: { dayOfMonth: 'asc' },
    });

    return expenses.map(toRecurringExpenseResponse);
  }

  async create(
    dto: CreateRecurringExpenseDto,
  ): Promise<IRecurringExpenseResponse> {
    const userId = await this.currentUser.getUserId();

    const created = await this.prisma.$transaction(async (tx) => {
      const expense = await tx.recurringExpense.create({
        data: {
          userId,
          name: dto.name,
          category: dto.category,
          estimatedAmount: new Prisma.Decimal(dto.estimatedAmount),
          isAmountFixed: dto.isAmountFixed ?? false,
          dayOfMonth: dto.dayOfMonth,
          active: dto.active ?? true,
        },
      });

      await this.budgetRecalculation.recalculateCurrentPeriod(tx, userId);

      return expense;
    }, CASCADE_TRANSACTION_OPTIONS);

    return toRecurringExpenseResponse(created);
  }

  async update(
    id: string,
    dto: UpdateRecurringExpenseDto,
  ): Promise<IRecurringExpenseResponse> {
    const userId = await this.currentUser.getUserId();
    await this.findOwned(id, userId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const expense = await tx.recurringExpense.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
          ...(dto.estimatedAmount !== undefined
            ? { estimatedAmount: new Prisma.Decimal(dto.estimatedAmount) }
            : {}),
          ...(dto.isAmountFixed !== undefined
            ? { isAmountFixed: dto.isAmountFixed }
            : {}),
          ...(dto.dayOfMonth !== undefined
            ? { dayOfMonth: dto.dayOfMonth }
            : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });

      await this.budgetRecalculation.recalculateCurrentPeriod(tx, userId);

      return expense;
    }, CASCADE_TRANSACTION_OPTIONS);

    return toRecurringExpenseResponse(updated);
  }

  async remove(id: string): Promise<void> {
    const userId = await this.currentUser.getUserId();
    await this.findOwned(id, userId);

    await this.prisma.$transaction(async (tx) => {
      await tx.recurringExpense.delete({ where: { id } });
      await this.budgetRecalculation.recalculateCurrentPeriod(tx, userId);
    }, CASCADE_TRANSACTION_OPTIONS);
  }

  private async findOwned(
    id: string,
    userId: string,
  ): Promise<RecurringExpense> {
    const expense = await this.prisma.recurringExpense.findFirst({
      where: { id, userId },
    });

    if (!expense) {
      throw new NotFoundException(`RecurringExpense ${id} not found`);
    }

    return expense;
  }
}
