import {
  AccountType,
  Prisma,
  TransactionType,
  type Account,
} from '@prisma/client';
import type { CurrentUserService } from '@common/services/current-user.service';
import { NetWorthService } from '@modules/net-worth/net-worth.service';
import type { PrismaService } from '@modules/prisma/prisma.service';
import { AccountsService } from './accounts.service';

/**
 * "Mis productos" (paso 3) no toca ningún cálculo: entidad, tarjeta débito,
 * dígitos y los tipos nuevos solo agrupan y describen. Se corren los servicios
 * reales de cuentas y patrimonio antes y después de reclasificar las 4 cuentas
 * como en docs/design-liabilities.md E.3, y las respuestas deben coincidir.
 * Ledger, presupuestos y reportes no leen la tabla de cuentas.
 */

const USER_ID = 'user_1';
const ANCHOR = new Date('2026-09-18T05:00:00Z');

interface Row {
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

const tx = (
  type: TransactionType,
  amount: number,
  accountId: string | null,
  toAccountId: string | null = null,
  date = '2026-10-01T17:00:00Z',
): Row => ({
  type,
  amount,
  accountId,
  toAccountId,
  transactionDate: new Date(date),
});

const TRANSACTIONS: Row[] = [
  tx(TransactionType.INCOME, 9_339_050, 'ahorros'),
  tx(TransactionType.EXPENSE, 1_650_000, 'ahorros'),
  tx(
    TransactionType.LOAN_GIVEN,
    4_000_000,
    'ahorros',
    null,
    '2026-07-01T15:39:00Z',
  ),
  tx(TransactionType.LOAN_REPAYMENT, 1_000_000, 'ahorros'),
  tx(TransactionType.EXPENSE, 283_134, 'visa'),
  tx(TransactionType.TRANSFER, 838_675, 'ahorros', 'visa'),
  tx(TransactionType.TRANSFER, 50_000, 'ahorros', 'efectivo'),
  tx(TransactionType.EXPENSE, 20_000, 'efectivo'),
  tx(TransactionType.EXPENSE, 297_615, null),
];

function account(
  id: string,
  type: AccountType,
  initialBalance: number,
): Account {
  return {
    id,
    userId: USER_ID,
    name: id,
    type,
    initialBalance: new Prisma.Decimal(initialBalance),
    initialBalanceDate: ANCHOR,
    institutionId: null,
    hasDebitCard: false,
    cardLast4: null,
    createdAt: ANCHOR,
    updatedAt: ANCHOR,
  };
}

/** Como están hoy en producción (§1.1). */
const BEFORE: Account[] = [
  account('ahorros', AccountType.DEBIT_CARD, 5_199_379.32),
  account('visa', AccountType.CREDIT_CARD, 1_766_523),
  account('efectivo', AccountType.CASH, 0),
  account('nequi', AccountType.SAVINGS_ACCOUNT, 1_968.34),
];

const INSTITUTIONS: Record<string, { id: string; name: string }> = {
  bancolombia: { id: 'bancolombia', name: 'Bancolombia' },
  nequi_inst: { id: 'nequi_inst', name: 'Nequi' },
};

/** Después de E.3 (sin la conversión de la tarjeta, que es el paso 4). */
const AFTER: Account[] = BEFORE.map((item) => {
  switch (item.id) {
    case 'ahorros':
      return {
        ...item,
        type: AccountType.SAVINGS_ACCOUNT,
        hasDebitCard: true,
        cardLast4: '1234',
        institutionId: 'bancolombia',
      };
    case 'visa':
      return { ...item, cardLast4: '9876', institutionId: 'bancolombia' };
    case 'nequi':
      return {
        ...item,
        type: AccountType.DIGITAL_WALLET,
        institutionId: 'nequi_inst',
      };
    default:
      return item;
  }
});

function matches(row: Row, where: AggregateWhere): boolean {
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
  return (
    !where.transactionDate || row.transactionDate >= where.transactionDate.gte
  );
}

function services(accounts: Account[]) {
  const decimal = (value: number) => new Prisma.Decimal(value);
  const prisma = {
    account: {
      findMany: jest.fn(({ include }: { include?: object }) =>
        Promise.resolve(
          accounts.map((item) =>
            include
              ? {
                  ...item,
                  institution: item.institutionId
                    ? INSTITUTIONS[item.institutionId]
                    : null,
                }
              : item,
          ),
        ),
      ),
    },
    transaction: {
      aggregate: jest.fn(({ where }: { where: AggregateWhere }) => {
        const rows = TRANSACTIONS.filter((row) => matches(row, where));
        return Promise.resolve({
          _sum: {
            amount: rows.length
              ? rows.reduce((sum, row) => sum.plus(row.amount), decimal(0))
              : null,
          },
        });
      }),
    },
    loan: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { amount: decimal(4_000_000), amountRepaid: decimal(1_000_000) },
      }),
    },
    goal: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { currentAmount: decimal(2_500_000) } }),
    },
  } as unknown as PrismaService;
  const currentUser = {
    getUserId: jest.fn().mockResolvedValue(USER_ID),
  } as unknown as CurrentUserService;

  const accountsService = new AccountsService(prisma, currentUser);
  return {
    accounts: accountsService,
    netWorth: new NetWorthService(prisma, currentUser, accountsService),
  };
}

describe('Mis productos: reclasificar las cuentas no cambia ningún cálculo', () => {
  it('GET /accounts: mismos saldos, cuenta por cuenta', async () => {
    const before = await services(BEFORE).accounts.findAll();
    const after = await services(AFTER).accounts.findAll();

    const balances = (list: typeof before) =>
      list.map(
        ({ id, initialBalance, initialBalanceDate, currentBalance }) => ({
          id,
          initialBalance,
          initialBalanceDate,
          currentBalance,
        }),
      );
    expect(balances(after)).toEqual(balances(before));
    expect(after.find((item) => item.id === 'ahorros')).toMatchObject({
      type: AccountType.SAVINGS_ACCOUNT,
      institution: { id: 'bancolombia', name: 'Bancolombia' },
      hasDebitCard: true,
    });
  });

  it('GET /net-worth: la respuesta completa es idéntica', async () => {
    const before = await services(BEFORE).netWorth.getNetWorth();
    const after = await services(AFTER).netWorth.getNetWorth();

    expect(after).toEqual(before);
    // The new types count as assets, like the old ones; the card stays out.
    expect(after.assets.accountsBalance).toBeCloseTo(
      5_199_379.32 +
        9_339_050 -
        1_650_000 +
        1_000_000 -
        838_675 -
        50_000 +
        (50_000 - 20_000) +
        1_968.34,
      2,
    );
    expect(after.info.unconfiguredCards).toEqual([
      {
        id: 'visa',
        name: 'visa',
        currentBalance: 1_766_523 - 283_134 + 838_675,
      },
    ]);
  });
});
