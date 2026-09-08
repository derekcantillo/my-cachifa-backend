import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Category, Prisma, TransactionType } from '@prisma/client';
import { BudgetRecalculationService } from '@modules/budgets/budget-recalculation.service';
import { CurrentUserService } from '@common/services/current-user.service';
import { currentMonthYear, toMonthYear } from '@common/utils/month.util';
import { PrismaService } from '@modules/prisma/prisma.service';
import type { CreateTransactionDto } from './dto/create-transaction.dto';
import type { UpdateTransactionDto } from './dto/update-transaction.dto';
import {
  toTransactionResponse,
  type ITransactionResponse,
  type TransactionWithAccount,
} from './interfaces/transaction-response.interface';

/** Solo estos tipos consumen presupuesto. */
const BUDGET_AFFECTING_TYPES: ReadonlySet<TransactionType> = new Set([
  TransactionType.EXPENSE,
  TransactionType.DEBT_PAYMENT,
]);

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly budgetRecalculation: BudgetRecalculationService,
  ) {}

  async findAll(month?: string): Promise<ITransactionResponse[]> {
    const userId = await this.currentUser.getUserId();

    const transactions = await this.prisma.transaction.findMany({
      where: { userId, monthYear: month ?? currentMonthYear() },
      include: { account: true },
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
    });

    return transactions.map(toTransactionResponse);
  }

  async findOne(id: string): Promise<ITransactionResponse> {
    const userId = await this.currentUser.getUserId();
    return toTransactionResponse(await this.findOwned(id, userId));
  }

  async create(dto: CreateTransactionDto): Promise<ITransactionResponse> {
    const userId = await this.currentUser.getUserId();
    const accountId = dto.accountId ?? null;
    await this.assertAccountOwnership(accountId, userId);
    const recurringExpenseId = dto.recurringExpenseId ?? null;
    await this.assertRecurringExpenseMatch(
      recurringExpenseId,
      userId,
      dto.category,
    );

    const transactionDate = dto.transactionDate
      ? new Date(dto.transactionDate)
      : new Date();
    const monthYear = toMonthYear(transactionDate);
    const amount = new Prisma.Decimal(dto.amount);
    const budgetPeriod = this.resolveBudgetPeriod(
      dto.type,
      dto.category,
      monthYear,
      dto.budgetPeriod,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          userId,
          accountId,
          recurringExpenseId,
          amount,
          type: dto.type,
          category: dto.category,
          description: dto.description ?? null,
          tags: dto.tags ?? [],
          // `rawMessage` existe para el flujo de WhatsApp; desde la API REST
          // guardamos la descripción como origen del registro.
          rawMessage: dto.description ?? '',
          transactionDate,
          monthYear,
          budgetPeriod,
        },
        include: { account: true },
      });

      if (BUDGET_AFFECTING_TYPES.has(dto.type)) {
        await this.addToBudget(tx, userId, monthYear, dto.category, amount);
      }

      if (dto.type === TransactionType.INCOME) {
        await this.budgetRecalculation.recalculateBudgets(
          tx,
          userId,
          budgetPeriod,
        );
      }

      return transaction;
    });

    return toTransactionResponse(created);
  }

  async update(
    id: string,
    dto: UpdateTransactionDto,
  ): Promise<ITransactionResponse> {
    const userId = await this.currentUser.getUserId();
    const existing = await this.findOwned(id, userId);

    if (dto.accountId !== undefined) {
      await this.assertAccountOwnership(dto.accountId, userId);
    }

    const nextType = dto.type ?? existing.type;
    const nextCategory = dto.category ?? existing.category;
    const nextAmount =
      dto.amount === undefined
        ? existing.amount
        : new Prisma.Decimal(dto.amount);
    const nextDate = dto.transactionDate
      ? new Date(dto.transactionDate)
      : existing.transactionDate;
    const nextMonthYear = toMonthYear(nextDate);
    const nextBudgetPeriod = this.resolveBudgetPeriod(
      nextType,
      nextCategory,
      nextMonthYear,
      dto.budgetPeriod,
      existing.budgetPeriod,
    );

    // Si el ingreso ya afectaba un mes (o pasa a afectarlo), recalcular tanto
    // el mes anterior como el nuevo — pueden diferir si la edición mueve
    // `budgetPeriod`/`monthYear` o cambia tipo/categoría.
    const affectedIncomeMonths = new Set(
      [existing.budgetPeriod, nextBudgetPeriod].filter(
        (month): month is string => Boolean(month),
      ),
    );
    const touchesIncome =
      existing.type === TransactionType.INCOME ||
      nextType === TransactionType.INCOME;

    const updated = await this.prisma.$transaction(async (tx) => {
      // Se revierte el efecto anterior y se aplica el nuevo. Esto cubre
      // cambios de monto, categoría, tipo y fecha (que puede mover el mes).
      if (BUDGET_AFFECTING_TYPES.has(existing.type)) {
        await this.removeFromBudget(
          tx,
          userId,
          existing.monthYear,
          existing.category,
          existing.amount,
        );
      }

      const transaction = await tx.transaction.update({
        where: { id },
        data: {
          amount: nextAmount,
          type: nextType,
          category: nextCategory,
          transactionDate: nextDate,
          monthYear: nextMonthYear,
          budgetPeriod: nextBudgetPeriod,
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.accountId !== undefined ? { accountId: dto.accountId } : {}),
          ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        },
        include: { account: true },
      });

      if (BUDGET_AFFECTING_TYPES.has(nextType)) {
        await this.addToBudget(
          tx,
          userId,
          nextMonthYear,
          nextCategory,
          nextAmount,
        );
      }

      if (touchesIncome) {
        for (const month of affectedIncomeMonths) {
          await this.budgetRecalculation.recalculateBudgets(tx, userId, month);
        }
      }

      return transaction;
    });

    return toTransactionResponse(updated);
  }

  async remove(id: string): Promise<void> {
    const userId = await this.currentUser.getUserId();
    const existing = await this.findOwned(id, userId);

    await this.prisma.$transaction(async (tx) => {
      if (BUDGET_AFFECTING_TYPES.has(existing.type)) {
        await this.removeFromBudget(
          tx,
          userId,
          existing.monthYear,
          existing.category,
          existing.amount,
        );
      }

      await tx.transaction.delete({ where: { id } });

      if (existing.type === TransactionType.INCOME && existing.budgetPeriod) {
        await this.budgetRecalculation.recalculateBudgets(
          tx,
          userId,
          existing.budgetPeriod,
        );
      }
    });
  }

  /**
   * SALARY exige un `budgetPeriod` explícito (desfase de nómina); cualquier
   * otro caso lo calcula del mes de la transacción e ignora lo que venga en
   * el body. `fallback` es el `budgetPeriod` ya guardado, para un update que
   * no lo reenvía pero cuyo tipo/categoría resultante sigue siendo SALARY.
   */
  private resolveBudgetPeriod(
    type: TransactionType,
    category: Category,
    monthYear: string,
    provided: string | undefined,
    fallback?: string | null,
  ): string {
    if (type === TransactionType.INCOME && category === Category.SALARY) {
      const value = provided ?? fallback ?? undefined;
      if (!value) {
        throw new BadRequestException(
          'budgetPeriod is required for SALARY income',
        );
      }
      return value;
    }

    return monthYear;
  }

  private async findOwned(
    id: string,
    userId: string,
  ): Promise<TransactionWithAccount> {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id, userId },
      include: { account: true },
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction ${id} not found`);
    }

    return transaction;
  }

  private async assertAccountOwnership(
    accountId: string | null | undefined,
    userId: string,
  ): Promise<void> {
    if (!accountId) return;

    const account = await this.prisma.account.findFirst({
      where: { id: accountId, userId },
      select: { id: true },
    });

    if (!account) {
      throw new BadRequestException(`Account ${accountId} not found`);
    }
  }

  private async assertRecurringExpenseMatch(
    recurringExpenseId: string | null,
    userId: string,
    category: Category,
  ): Promise<void> {
    if (!recurringExpenseId) return;

    const expense = await this.prisma.recurringExpense.findFirst({
      where: { id: recurringExpenseId, userId },
      select: { category: true },
    });

    if (!expense) {
      throw new BadRequestException(
        `RecurringExpense ${recurringExpenseId} not found`,
      );
    }

    if (expense.category !== category) {
      throw new BadRequestException(
        `RecurringExpense ${recurringExpenseId} category (${expense.category}) does not match transaction category (${category})`,
      );
    }
  }

  /** Suma al presupuesto del mes/categoría, creándolo con límite 0 si no existe. */
  private async addToBudget(
    tx: Prisma.TransactionClient,
    userId: string,
    monthYear: string,
    category: Category,
    amount: Prisma.Decimal,
  ): Promise<void> {
    await tx.budget.upsert({
      where: { userId_monthYear_category: { userId, monthYear, category } },
      create: {
        userId,
        monthYear,
        category,
        limitAmount: 0,
        spentAmount: amount,
      },
      update: { spentAmount: { increment: amount } },
    });
  }

  /**
   * Resta del presupuesto del mes/categoría. Se usa `updateMany` para que sea
   * un no-op si el presupuesto ya no existe, en vez de fallar con P2025.
   */
  private async removeFromBudget(
    tx: Prisma.TransactionClient,
    userId: string,
    monthYear: string,
    category: Category,
    amount: Prisma.Decimal,
  ): Promise<void> {
    await tx.budget.updateMany({
      where: { userId, monthYear, category },
      data: { spentAmount: { decrement: amount } },
    });
  }
}
