import { Injectable, NotFoundException } from '@nestjs/common';
import { Account, Prisma, TransactionType } from '@prisma/client';
import { CurrentUserService } from '@common/services/current-user.service';
import { PrismaService } from '@modules/prisma/prisma.service';
import type { CreateAccountDto } from './dto/create-account.dto';
import type { UpdateInitialBalanceDto } from './dto/update-initial-balance.dto';
import {
  toAccountResponse,
  type IAccountResponse,
} from './interfaces/account-response.interface';

const ZERO = new Prisma.Decimal(0);

export interface IAccountBalance {
  account: Account;
  currentBalance: Prisma.Decimal;
}

/** Suman al saldo de la cuenta. */
const BALANCE_INCREASING_TYPES: TransactionType[] = [
  TransactionType.INCOME,
  TransactionType.LOAN_REPAYMENT,
];

/**
 * Restan del saldo de la cuenta (`accountId`) — el ahorro también, porque sale
 * de aquí hacia la meta, y una `TRANSFER` desde su origen.
 */
const BALANCE_DECREASING_TYPES: TransactionType[] = [
  TransactionType.EXPENSE,
  TransactionType.SAVING,
  TransactionType.DEBT_PAYMENT,
  TransactionType.LOAN_GIVEN,
  TransactionType.TRANSFER,
];

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async findAll(): Promise<IAccountResponse[]> {
    const userId = await this.currentUser.getUserId();

    const accounts = await this.prisma.account.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    return Promise.all(
      accounts.map(async (account) =>
        toAccountResponse(account, await this.computeCurrentBalance(account)),
      ),
    );
  }

  async create(dto: CreateAccountDto): Promise<IAccountResponse> {
    const userId = await this.currentUser.getUserId();

    const account = await this.prisma.account.create({
      data: { userId, name: dto.name, type: dto.type },
    });

    return toAccountResponse(
      account,
      await this.computeCurrentBalance(account),
    );
  }

  async updateInitialBalance(
    id: string,
    dto: UpdateInitialBalanceDto,
  ): Promise<IAccountResponse> {
    const userId = await this.currentUser.getUserId();
    await this.findOwned(id, userId);

    const account = await this.prisma.account.update({
      where: { id },
      data: {
        initialBalance: new Prisma.Decimal(dto.amount),
        initialBalanceDate: new Date(dto.date),
      },
    });

    return toAccountResponse(
      account,
      await this.computeCurrentBalance(account),
    );
  }

  /** Cada cuenta del usuario con su `currentBalance`, para quien necesite separarlas por tipo. */
  async getBalances(userId: string): Promise<IAccountBalance[]> {
    const accounts = await this.prisma.account.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(
      accounts.map(async (account) => ({
        account,
        currentBalance: await this.computeCurrentBalance(account),
      })),
    );
  }

  private async findOwned(id: string, userId: string): Promise<Account> {
    const account = await this.prisma.account.findFirst({
      where: { id, userId },
    });

    if (!account) {
      throw new NotFoundException(`Account ${id} not found`);
    }

    return account;
  }

  /**
   * `initialBalance` más lo que sumen o resten las `Transaction`s de esta
   * cuenta desde `initialBalanceDate` en adelante — sin esa fecha, se cuenta
   * todo el historial, que es como se comportaba antes de que existiera.
   * Una `TRANSFER` resta en su origen y suma en su destino (`toAccountId`):
   * pagar una tarjeta sube su saldo hacia 0.
   */
  private async computeCurrentBalance(
    account: Account,
  ): Promise<Prisma.Decimal> {
    const dateFilter = account.initialBalanceDate
      ? { transactionDate: { gte: account.initialBalanceDate } }
      : {};

    const [increases, incomingTransfers, decreases] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: {
          accountId: account.id,
          type: { in: BALANCE_INCREASING_TYPES },
          ...dateFilter,
        },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          toAccountId: account.id,
          type: TransactionType.TRANSFER,
          ...dateFilter,
        },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          accountId: account.id,
          type: { in: BALANCE_DECREASING_TYPES },
          ...dateFilter,
        },
        _sum: { amount: true },
      }),
    ]);

    const increaseTotal = (increases._sum.amount ?? ZERO).plus(
      incomingTransfers._sum.amount ?? ZERO,
    );
    const decreaseTotal = decreases._sum.amount ?? ZERO;

    return account.initialBalance.plus(increaseTotal).minus(decreaseTotal);
  }
}
