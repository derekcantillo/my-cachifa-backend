import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Category } from '@prisma/client';
import { BudgetRecalculationService } from '@modules/budgets/budget-recalculation.service';
import { CurrentUserService } from '@common/services/current-user.service';
import { toMonthYear } from '@common/utils/month.util';
import {
  FinancialPeriodService,
  earliestDate,
  isSalary,
} from '@modules/financial-periods/financial-period.service';
import { CASCADE_TRANSACTION_OPTIONS } from '@modules/period-ledger/period-ledger.constants';
import { PrismaService } from '@modules/prisma/prisma.service';
import type { CreateTransactionDto } from './dto/create-transaction.dto';
import type { UpdateTransactionDto } from './dto/update-transaction.dto';
import {
  toTransactionResponse,
  type ITransactionResponse,
  type TransactionWithAccount,
} from './interfaces/transaction-response.interface';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly budgetRecalculation: BudgetRecalculationService,
    private readonly financialPeriods: FinancialPeriodService,
  ) {}

  async findAll(periodId?: string): Promise<ITransactionResponse[]> {
    const userId = await this.currentUser.getUserId();
    const period = await this.financialPeriods.resolvePeriod(
      this.prisma,
      userId,
      periodId,
    );

    const transactions = await this.prisma.transaction.findMany({
      where: { userId, periodId: period.id },
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

    const created = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          userId,
          accountId,
          recurringExpenseId,
          amount: new Prisma.Decimal(dto.amount),
          type: dto.type,
          category: dto.category,
          description: dto.description ?? null,
          tags: dto.tags ?? [],
          // `rawMessage` existe para el flujo de WhatsApp; desde la API REST
          // guardamos la descripción como origen del registro.
          rawMessage: dto.description ?? '',
          transactionDate,
          // Deprecado: solo lo lee el móvil. `budgetPeriod` ya no se escribe.
          monthYear: toMonthYear(transactionDate),
        },
        include: { account: true },
      });

      // Un salario abre su período y cierra el anterior; cualquier otra
      // transacción solo cae en el período que cubre su fecha.
      const { period, affectedFrom } =
        await this.financialPeriods.assignTransactionToPeriod(tx, transaction);
      transaction.periodId = period.id;

      await this.budgetRecalculation.recalculateFrom(tx, userId, affectedFrom);

      return transaction;
    }, CASCADE_TRANSACTION_OPTIONS);

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

    const nextDate = dto.transactionDate
      ? new Date(dto.transactionDate)
      : existing.transactionDate;

    const updated = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.update({
        where: { id },
        data: {
          ...(dto.amount !== undefined
            ? { amount: new Prisma.Decimal(dto.amount) }
            : {}),
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
          transactionDate: nextDate,
          monthYear: toMonthYear(nextDate),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.accountId !== undefined ? { accountId: dto.accountId } : {}),
          ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        },
        include: { account: true },
      });

      // Si antes era salario (y ahora cambió de fecha o dejó de serlo), su
      // período viejo se rehace o se fusiona con el anterior; si ahora es
      // salario, `assignTransactionToPeriod` abre el suyo.
      let affectedFrom = earliestDate(existing.transactionDate, nextDate);
      if (isSalary(existing)) {
        const boundary = await this.financialPeriods.recalculatePeriodsFrom(
          tx,
          userId,
          affectedFrom,
        );
        affectedFrom = earliestDate(affectedFrom, boundary);
      }
      const assignment = await this.financialPeriods.assignTransactionToPeriod(
        tx,
        transaction,
      );
      transaction.periodId = assignment.period.id;

      // La cascada parte del período más antiguo entre el estado previo y el
      // nuevo: una edición retroactiva mueve el rollover de todo lo posterior.
      await this.budgetRecalculation.recalculateFrom(
        tx,
        userId,
        earliestDate(affectedFrom, assignment.affectedFrom),
      );

      return transaction;
    }, CASCADE_TRANSACTION_OPTIONS);

    return toTransactionResponse(updated);
  }

  async remove(id: string): Promise<void> {
    const userId = await this.currentUser.getUserId();
    const existing = await this.findOwned(id, userId);

    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.delete({ where: { id } });

      // Borrar un salario fusiona su período con el anterior.
      let affectedFrom = existing.transactionDate;
      if (isSalary(existing)) {
        const boundary = await this.financialPeriods.recalculatePeriodsFrom(
          tx,
          userId,
          existing.transactionDate,
        );
        affectedFrom = earliestDate(affectedFrom, boundary);
      }

      await this.budgetRecalculation.recalculateFrom(tx, userId, affectedFrom);
    }, CASCADE_TRANSACTION_OPTIONS);
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
}
