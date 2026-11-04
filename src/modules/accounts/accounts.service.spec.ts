import {
  AccountType,
  Prisma,
  TransactionType,
  type Account,
} from '@prisma/client';
import type { CurrentUserService } from '@common/services/current-user.service';
import type { PrismaService } from '@modules/prisma/prisma.service';
import { AccountsService } from './accounts.service';

const USER_ID = 'user_1';
const ANCHOR = new Date('2026-09-18T05:00:00Z');

interface StoredTransaction {
  accountId: string | null;
  toAccountId: string | null;
  type: TransactionType;
  amount: number;
  transactionDate: Date;
}

interface AggregateWhere {
  accountId?: string;
  toAccountId?: string;
  type?: TransactionType | { in: TransactionType[] };
  transactionDate?: { gte: Date };
}

function account(
  id: string,
  type: AccountType,
  initialBalance: number,
  initialBalanceDate: Date | null = ANCHOR,
): Account {
  return {
    id,
    userId: USER_ID,
    name: id,
    type,
    initialBalance: new Prisma.Decimal(initialBalance),
    initialBalanceDate,
    createdAt: ANCHOR,
    updatedAt: ANCHOR,
  };
}

function tx(
  type: TransactionType,
  amount: number,
  accountId: string | null,
  date = '2026-10-01T17:00:00Z',
  toAccountId: string | null = null,
): StoredTransaction {
  return {
    type,
    amount,
    accountId,
    toAccountId,
    transactionDate: new Date(date),
  };
}

/** In-memory `transaction.aggregate` that understands the filters the service uses. */
function matches(row: StoredTransaction, where: AggregateWhere): boolean {
  if (where.accountId !== undefined && row.accountId !== where.accountId) {
    return false;
  }
  if (
    where.toAccountId !== undefined &&
    row.toAccountId !== where.toAccountId
  ) {
    return false;
  }
  if (typeof where.type === 'string' && row.type !== where.type) return false;
  if (typeof where.type === 'object' && !where.type.in.includes(row.type)) {
    return false;
  }
  if (
    where.transactionDate &&
    row.transactionDate < where.transactionDate.gte
  ) {
    return false;
  }
  return true;
}

function setup(accounts: Account[], transactions: StoredTransaction[]) {
  const prisma = {
    account: { findMany: jest.fn().mockResolvedValue(accounts) },
    transaction: {
      aggregate: jest.fn(({ where }: { where: AggregateWhere }) => {
        const rows = transactions.filter((row) => matches(row, where));
        return Promise.resolve({
          _sum: {
            amount: rows.length
              ? rows.reduce(
                  (sum, row) => sum.plus(row.amount),
                  new Prisma.Decimal(0),
                )
              : null,
          },
        });
      }),
    },
  };
  return new AccountsService(
    prisma as unknown as PrismaService,
    {
      getUserId: jest.fn().mockResolvedValue(USER_ID),
    } as unknown as CurrentUserService,
  );
}

/** The balance formula as it was before TRANSFER existed. */
function legacyBalance(
  target: Account,
  transactions: StoredTransaction[],
): number {
  const since = target.initialBalanceDate;
  return transactions
    .filter((row) => row.accountId === target.id)
    .filter((row) => !since || row.transactionDate >= since)
    .reduce((balance, row) => {
      switch (row.type) {
        case TransactionType.INCOME:
        case TransactionType.LOAN_REPAYMENT:
          return balance + row.amount;
        case TransactionType.EXPENSE:
        case TransactionType.SAVING:
        case TransactionType.DEBT_PAYMENT:
        case TransactionType.LOAN_GIVEN:
          return balance - row.amount;
        default:
          throw new Error(`unexpected ${row.type}`);
      }
    }, target.initialBalance.toNumber());
}

const balancesById = async (service: AccountsService) =>
  Object.fromEntries(
    (await service.findAll()).map((item) => [item.id, item.currentBalance]),
  );

describe('AccountsService — saldos', () => {
  it('sin transferencias, ningún saldo cambia respecto a la fórmula anterior', async () => {
    const accounts = [
      account('savings', AccountType.DEBIT_CARD, 5_199_379.32),
      account('visa', AccountType.CREDIT_CARD, 1_766_523),
      account('cash', AccountType.CASH, 0, null),
      account('nequi', AccountType.SAVINGS_ACCOUNT, 1_968.34),
    ];
    const transactions = [
      tx(TransactionType.INCOME, 9_339_050, 'savings'),
      tx(TransactionType.EXPENSE, 1_650_000, 'savings'),
      tx(TransactionType.DEBT_PAYMENT, 297_615, 'savings'),
      tx(TransactionType.SAVING, 200_000, 'savings'),
      tx(
        TransactionType.LOAN_GIVEN,
        4_000_000,
        'savings',
        '2026-07-01T15:39:00Z',
      ),
      tx(TransactionType.LOAN_REPAYMENT, 4_000_000, 'savings'),
      tx(TransactionType.EXPENSE, 149_400, 'visa', '2026-09-01T20:45:00Z'),
      tx(TransactionType.EXPENSE, 283_134, 'visa'),
      tx(TransactionType.EXPENSE, 50_000, 'cash', '2026-06-01T17:00:00Z'),
      tx(TransactionType.EXPENSE, 297_615, null),
    ];

    const balances = await balancesById(setup(accounts, transactions));

    for (const item of accounts) {
      expect(balances[item.id]).toBeCloseTo(
        legacyBalance(item, transactions),
        2,
      );
    }
    expect(balances.visa).toBe(1_766_523 - 283_134);
  });

  it('una transferencia baja el origen y sube el destino por el mismo monto', async () => {
    const accounts = [
      account('savings', AccountType.SAVINGS_ACCOUNT, 5_000_000),
      account('cash', AccountType.CASH, 100_000),
    ];
    const balances = await balancesById(
      setup(accounts, [
        tx(TransactionType.TRANSFER, 300_000, 'savings', undefined, 'cash'),
      ]),
    );

    expect(balances).toEqual({ savings: 4_700_000, cash: 400_000 });
  });

  it('pagar una tarjeta (saldo negativo = deuda) sube su saldo hacia 0', async () => {
    const accounts = [
      account('savings', AccountType.SAVINGS_ACCOUNT, 5_000_000),
      account('visa', AccountType.CREDIT_CARD, -1_000_000),
    ];
    const balances = await balancesById(
      setup(accounts, [
        tx(TransactionType.EXPENSE, 200_000, 'visa'),
        tx(TransactionType.TRANSFER, 838_675, 'savings', undefined, 'visa'),
      ]),
    );

    expect(balances.savings).toBe(4_161_325);
    expect(balances.visa).toBe(-1_000_000 - 200_000 + 838_675);
  });

  it('cada lado respeta la fecha de su propio saldo inicial', async () => {
    const accounts = [
      account('savings', AccountType.SAVINGS_ACCOUNT, 1_000_000, ANCHOR),
      // Anchored after the transfer: it is already inside its starting balance.
      account(
        'visa',
        AccountType.CREDIT_CARD,
        -4_539_024,
        new Date('2026-11-01T05:00:00Z'),
      ),
    ];
    const balances = await balancesById(
      setup(accounts, [
        tx(
          TransactionType.TRANSFER,
          838_675,
          'savings',
          '2026-10-04T17:00:00Z',
          'visa',
        ),
      ]),
    );

    expect(balances).toEqual({ savings: 161_325, visa: -4_539_024 });
  });

  it('getBalances devuelve cada cuenta con su saldo, transferencias incluidas', async () => {
    const accounts = [
      account('savings', AccountType.SAVINGS_ACCOUNT, 1_000_000),
      account('cash', AccountType.CASH, 0),
    ];
    const service = setup(accounts, [
      tx(TransactionType.TRANSFER, 250_000, 'savings', undefined, 'cash'),
    ]);

    const balances = await service.getBalances(USER_ID);

    expect(
      balances.map(({ account: item, currentBalance }) => [
        item.id,
        currentBalance.toNumber(),
      ]),
    ).toEqual([
      ['savings', 750_000],
      ['cash', 250_000],
    ]);
  });
});
