import { Injectable } from '@nestjs/common';
import { LoanStatus, Prisma } from '@prisma/client';
import { CurrentUserService } from '@common/services/current-user.service';
import { AccountsService } from '@modules/accounts/accounts.service';
import { PrismaService } from '@modules/prisma/prisma.service';
import type { INetWorthResponse } from './interfaces/net-worth-response.interface';

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class NetWorthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly accounts: AccountsService,
  ) {}

  async getNetWorth(): Promise<INetWorthResponse> {
    const userId = await this.currentUser.getUserId();

    const [accountsBalance, openLoans, goals] = await Promise.all([
      this.accounts.getTotalBalance(userId),
      this.prisma.loan.aggregate({
        where: { userId, status: { not: LoanStatus.PAID } },
        _sum: { amount: true, amountRepaid: true },
      }),
      this.prisma.goal.aggregate({
        where: { userId },
        _sum: { currentAmount: true },
      }),
    ]);

    const receivables = (openLoans._sum.amount ?? ZERO).minus(
      openLoans._sum.amountRepaid ?? ZERO,
    );
    const goalsSavings = goals._sum.currentAmount ?? ZERO;
    // Frentes posteriores (tarjetas de crédito, deudas propias): en cero.
    const creditCardsAvailable = ZERO;
    const debts = ZERO;
    const creditCardsDebt = ZERO;

    const totalAssets = accountsBalance
      .plus(receivables)
      .plus(goalsSavings)
      .plus(creditCardsAvailable);
    const totalLiabilities = debts.plus(creditCardsDebt);

    return {
      assets: {
        accountsBalance: accountsBalance.toNumber(),
        receivables: receivables.toNumber(),
        goalsSavings: goalsSavings.toNumber(),
        creditCardsAvailable: creditCardsAvailable.toNumber(),
      },
      liabilities: {
        debts: debts.toNumber(),
        creditCardsDebt: creditCardsDebt.toNumber(),
      },
      netWorth: totalAssets.minus(totalLiabilities).toNumber(),
    };
  }
}
