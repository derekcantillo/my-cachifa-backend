import { Injectable } from '@nestjs/common';
import { AccountType, LoanStatus, Prisma } from '@prisma/client';
import { CurrentUserService } from '@common/services/current-user.service';
import { AccountsService } from '@modules/accounts/accounts.service';
import { creditCardFigures } from '@modules/accounts/lib/credit-card';
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
   * Una tarjeta con cupo configurado entra con su deuda como pasivo (y un saldo
   * a favor, como activo); su disponible es solo informativo. Sin cupo, su
   * saldo no tiene un signo confiable (la TC VISA guardaba el cupo disponible),
   * así que queda fuera de los totales, en `info.unconfiguredCards`.
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

    const isCard = ({ account }: { account: { type: AccountType } }) =>
      account.type === AccountType.CREDIT_CARD;
    const unconfiguredCards = balances.filter(
      (item) => isCard(item) && item.account.creditLimit === null,
    );
    const cardFigures = balances.flatMap(({ account, currentBalance }) =>
      isCard({ account }) && account.creditLimit !== null
        ? [
            {
              ...creditCardFigures(currentBalance, account.creditLimit),
              credit: Prisma.Decimal.max(ZERO, currentBalance),
            },
          ]
        : [],
    );
    const sum = (values: Prisma.Decimal[]) =>
      values.reduce((total, value) => total.plus(value), ZERO);

    // Cuentas que no son tarjeta, más los saldos a favor de las tarjetas configuradas.
    const accountsBalance = sum(
      balances
        .filter((item) => !isCard(item))
        .map(({ currentBalance }) => currentBalance),
    ).plus(sum(cardFigures.map(({ credit }) => credit)));
    const creditCardsDebt = sum(cardFigures.map(({ debt }) => debt));
    const creditCardsAvailable = sum(
      cardFigures.map(({ available }) => available),
    );

    const receivables = (openLoans._sum.amount ?? ZERO).minus(
      openLoans._sum.amountRepaid ?? ZERO,
    );
    const goalsSavings = goals._sum.currentAmount ?? ZERO;
    // Deudas propias: fase 2.
    const debts = ZERO;

    const totalAssets = accountsBalance.plus(receivables);
    const totalLiabilities = debts.plus(creditCardsDebt);

    return {
      assets: {
        accountsBalance: accountsBalance.toNumber(),
        receivables: receivables.toNumber(),
        goalsSavings: goalsSavings.toNumber(),
        // Deprecated and outside the totals: kept at 0 so older clients that
        // still add it to their assets do not count the available credit.
        creditCardsAvailable: 0,
      },
      liabilities: {
        debts: debts.toNumber(),
        creditCardsDebt: creditCardsDebt.toNumber(),
      },
      info: {
        goalsSavings: goalsSavings.toNumber(),
        creditCardsAvailable: creditCardsAvailable.toNumber(),
        unconfiguredCards: unconfiguredCards.map(
          ({ account, currentBalance }) => ({
            id: account.id,
            name: account.name,
            currentBalance: currentBalance.toNumber(),
          }),
        ),
      },
      totals: {
        assets: totalAssets.toNumber(),
        liabilities: totalLiabilities.toNumber(),
      },
      netWorth: totalAssets.minus(totalLiabilities).toNumber(),
    };
  }
}
