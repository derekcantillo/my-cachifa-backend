import { AccountType, Prisma, type Account } from '@prisma/client';
import type { CurrentUserService } from '@common/services/current-user.service';
import type {
  AccountsService,
  IAccountBalance,
} from '@modules/accounts/accounts.service';
import type { PrismaService } from '@modules/prisma/prisma.service';
import { NetWorthService } from './net-worth.service';

const USER_ID = 'user_1';
const CREATED = new Date('2026-09-18T17:00:00Z');

function balance(
  id: string,
  type: AccountType,
  currentBalance: number,
  creditLimit: number | null = null,
): IAccountBalance {
  const account: Account = {
    id,
    userId: USER_ID,
    name: `Cuenta ${id}`,
    type,
    initialBalance: new Prisma.Decimal(0),
    initialBalanceDate: CREATED,
    institutionId: null,
    hasDebitCard: false,
    cardLast4: null,
    creditLimit: creditLimit === null ? null : new Prisma.Decimal(creditLimit),
    statementDay: null,
    paymentDueDay: null,
    defaultMonthlyRate: null,
    createdAt: CREATED,
    updatedAt: CREATED,
  };
  return { account, currentBalance: new Prisma.Decimal(currentBalance) };
}

function setup({
  balances,
  loanAmount = null,
  loanRepaid = null,
  goalsSaved = null,
}: {
  balances: IAccountBalance[];
  loanAmount?: number | null;
  loanRepaid?: number | null;
  goalsSaved?: number | null;
}) {
  const decimal = (value: number | null) =>
    value === null ? null : new Prisma.Decimal(value);
  const prisma = {
    loan: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: {
          amount: decimal(loanAmount),
          amountRepaid: decimal(loanRepaid),
        },
      }),
    },
    goal: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { currentAmount: decimal(goalsSaved) } }),
    },
  };
  const currentUser = { getUserId: jest.fn().mockResolvedValue(USER_ID) };
  const accounts = { getBalances: jest.fn().mockResolvedValue(balances) };

  return new NetWorthService(
    prisma as unknown as PrismaService,
    currentUser as unknown as CurrentUserService,
    accounts as unknown as AccountsService,
  );
}

describe('NetWorthService', () => {
  it('does not add goal savings on top of the accounts that hold them', async () => {
    // Savings account with 5.000.000; a goal says 2.000.000 were already saved
    // plus a 500.000 contribution, all of it inside that same account.
    const service = setup({
      balances: [balance('savings', AccountType.SAVINGS_ACCOUNT, 5_000_000)],
      goalsSaved: 2_500_000,
    });

    const result = await service.getNetWorth();

    expect(result.netWorth).toBe(5_000_000);
    expect(result.totals).toEqual({ assets: 5_000_000, liabilities: 0 });
    expect(result.info.goalsSavings).toBe(2_500_000);
  });

  it('adds what is still owed on open loans', async () => {
    const service = setup({
      balances: [balance('savings', AccountType.SAVINGS_ACCOUNT, 1_000_000)],
      loanAmount: 4_000_000,
      loanRepaid: 1_500_000,
    });

    const result = await service.getNetWorth();

    expect(result.assets.receivables).toBe(2_500_000);
    expect(result.netWorth).toBe(3_500_000);
  });

  it('leaves credit cards out of the totals and lists them as unconfigured', async () => {
    const service = setup({
      balances: [
        balance('debit', AccountType.DEBIT_CARD, 14_810_463.22),
        balance('visa', AccountType.CREDIT_CARD, 1_007_408),
        balance('other_card', AccountType.CREDIT_CARD, -250_000),
        balance('cash', AccountType.CASH, 0),
        balance('nequi', AccountType.SAVINGS_ACCOUNT, 1_968.34),
      ],
    });

    const result = await service.getNetWorth();

    expect(result.assets.accountsBalance).toBeCloseTo(14_812_431.56, 2);
    expect(result.netWorth).toBeCloseTo(14_812_431.56, 2);
    expect(result.liabilities.creditCardsDebt).toBe(0);
    expect(result.info.unconfiguredCards).toEqual([
      { id: 'visa', name: 'Cuenta visa', currentBalance: 1_007_408 },
      { id: 'other_card', name: 'Cuenta other_card', currentBalance: -250_000 },
    ]);
  });

  it('counts the debt of configured cards as a liability; their available credit is only info', async () => {
    const service = setup({
      balances: [
        balance('savings', AccountType.SAVINGS_ACCOUNT, 14_810_463.22),
        balance('visa', AccountType.CREDIT_CARD, -4_539_024, 4_300_000),
        balance('davivienda', AccountType.CREDIT_CARD, -4_670_990, 11_500_000),
      ],
    });

    const result = await service.getNetWorth();

    expect(result.liabilities.creditCardsDebt).toBe(9_210_014);
    expect(result.totals).toEqual({
      assets: 14_810_463.22,
      liabilities: 9_210_014,
    });
    expect(result.netWorth).toBeCloseTo(14_810_463.22 - 9_210_014, 2);
    // VISA is over its limit: 0 available, never negative.
    expect(result.info.creditCardsAvailable).toBe(6_829_010);
    expect(result.assets.creditCardsAvailable).toBe(0);
    expect(result.info.unconfiguredCards).toEqual([]);
  });

  it('a credit balance on a configured card is an asset, not a negative debt', async () => {
    const service = setup({
      balances: [
        balance('savings', AccountType.SAVINGS_ACCOUNT, 1_000_000),
        balance('visa', AccountType.CREDIT_CARD, 50_000, 4_300_000),
      ],
    });

    const result = await service.getNetWorth();

    expect(result.assets.accountsBalance).toBe(1_050_000);
    expect(result.liabilities.creditCardsDebt).toBe(0);
    expect(result.info.creditCardsAvailable).toBe(4_300_000);
    expect(result.netWorth).toBe(1_050_000);
  });

  it('only cards without a limit stay out of the totals as unconfigured', async () => {
    const service = setup({
      balances: [
        balance('savings', AccountType.SAVINGS_ACCOUNT, 5_000_000),
        balance('visa', AccountType.CREDIT_CARD, 1_007_408),
        balance('davivienda', AccountType.CREDIT_CARD, -4_670_990, 11_500_000),
      ],
    });

    const result = await service.getNetWorth();

    expect(result.info.unconfiguredCards).toEqual([
      { id: 'visa', name: 'Cuenta visa', currentBalance: 1_007_408 },
    ]);
    expect(result.netWorth).toBe(5_000_000 - 4_670_990);
  });

  it('keeps the deprecated asset fields for older clients, outside the totals', async () => {
    const service = setup({
      balances: [balance('savings', AccountType.SAVINGS_ACCOUNT, 800_000)],
      goalsSaved: 300_000,
    });

    const result = await service.getNetWorth();

    expect(result.assets.goalsSavings).toBe(300_000);
    expect(result.assets.creditCardsAvailable).toBe(0);
    expect(result.info.creditCardsAvailable).toBe(0);
    expect(result.totals.assets).toBe(800_000);
    expect(result.netWorth).toBe(800_000);
  });

  it('returns zeros and no cards when there is nothing', async () => {
    const service = setup({ balances: [] });

    await expect(service.getNetWorth()).resolves.toEqual({
      assets: {
        accountsBalance: 0,
        receivables: 0,
        goalsSavings: 0,
        creditCardsAvailable: 0,
      },
      liabilities: { debts: 0, creditCardsDebt: 0 },
      info: { goalsSavings: 0, creditCardsAvailable: 0, unconfiguredCards: [] },
      totals: { assets: 0, liabilities: 0 },
      netWorth: 0,
    });
  });
});
