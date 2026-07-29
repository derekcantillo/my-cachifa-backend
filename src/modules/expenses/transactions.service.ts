import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Category, Prisma, TransactionType } from '@prisma/client';
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

    const transactionDate = dto.transactionDate
      ? new Date(dto.transactionDate)
      : new Date();
    const monthYear = toMonthYear(transactionDate);
    const amount = new Prisma.Decimal(dto.amount);

    const created = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          userId,
          accountId,
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
        },
        include: { account: true },
      });

      if (BUDGET_AFFECTING_TYPES.has(dto.type)) {
        await this.addToBudget(tx, userId, monthYear, dto.category, amount);
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
    });
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
