import { Injectable } from '@nestjs/common';
import { AccountType, LoanStatus, Prisma } from '@prisma/client';
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

  /**
   * `netWorth = accountsBalance + receivables − debts − creditCardsDebt`.
   *
   * Las metas no suman: un aporte no es una transacción, así que esa plata ya
   * está en el saldo de alguna cuenta (son apartados, no un activo aparte).
   * Las tarjetas tampoco: sin cupo configurado su saldo no tiene un signo
   * confiable (la TC VISA guarda el cupo disponible, no la deuda), así que
   * quedan fuera de los totales y se listan en `info.unconfiguredCards`.
   * Ver `docs/design-liabilities.md` §C.
   */
  async getNetWorth(): Promise<INetWorthResponse> {
    const userId = await this.currentUser.getUserId();

    const [balances, openLoans, goals] = await Promise.all([
      this.accounts.getBalances(userId),
      this.prisma.loan.aggregate({
        where: { userId, status: { not: LoanStatus.PAID } },
        _sum: { amount: true, amountRepaid: true },
      }),
      this.prisma.goal.aggregate({
        where: { userId },
        _sum: { currentAmount: true },
      }),
    ]);

    // Hasta que exista `creditLimit` (paso 4), ninguna tarjeta está configurada.
    const cards = balances.filter(
      ({ account }) => account.type === AccountType.CREDIT_CARD,
    );
    const accountsBalance = balances
      .filter(({ account }) => account.type !== AccountType.CREDIT_CARD)
      .reduce((sum, { currentBalance }) => sum.plus(currentBalance), ZERO);

    const receivables = (openLoans._sum.amount ?? ZERO).minus(
      openLoans._sum.amountRepaid ?? ZERO,
    );
    const goalsSavings = goals._sum.currentAmount ?? ZERO;
    // Frentes posteriores (cupo de tarjetas, deudas propias): en cero.
    const creditCardsAvailable = ZERO;
    const debts = ZERO;
    const creditCardsDebt = ZERO;

    const totalAssets = accountsBalance.plus(receivables);
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
      info: {
        goalsSavings: goalsSavings.toNumber(),
        creditCardsAvailable: creditCardsAvailable.toNumber(),
        unconfiguredCards: cards.map(({ account, currentBalance }) => ({
          id: account.id,
          name: account.name,
          currentBalance: currentBalance.toNumber(),
        })),
      },
      totals: {
        assets: totalAssets.toNumber(),
        liabilities: totalLiabilities.toNumber(),
      },
      netWorth: totalAssets.minus(totalLiabilities).toNumber(),
    };
  }
}
