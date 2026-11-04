import {
  AlertType,
  Category,
  Prisma,
  TransactionType,
  type FinancialPeriod,
  type PeriodLedger,
} from '@prisma/client';
import type { AlertsService } from '@modules/alerts/alerts.service';
import type { FinancialPeriodService } from '@modules/financial-periods/financial-period.service';
import { IncomeCalculatorService } from '@modules/period-ledger/income-calculator.service';
import { PeriodLedgerService } from '@modules/period-ledger/period-ledger.service';
import { BudgetRecalculationService } from './budget-recalculation.service';

/**
 * TRANSFER (card payments, moving money between accounts) must stay out of the
 * ledger, the effective income, the budgets and the deficit alert. Those
 * services filter by type whitelists; this runs the real services over an
 * in-memory client with large transfers that would break every number if any
 * whitelist let them in.
 */

const USER_ID = 'user_1';
const NOW = new Date('2026-10-20T17:00:00Z');

const CLOSED: FinancialPeriod = {
  id: 'period_sep',
  userId: USER_ID,
  label: '28 ago 2026 – 28 sep 2026',
  startDate: new Date('2026-08-28T05:00:00Z'),
  endDate: new Date('2026-09-29T05:00:00Z'),
  anchorTxId: 'salary_aug',
  createdAt: NOW,
  updatedAt: NOW,
};

const OPEN: FinancialPeriod = {
  id: 'period_oct',
  userId: USER_ID,
  label: '29 sep 2026 – en curso',
  startDate: new Date('2026-09-29T05:00:00Z'),
  endDate: null,
  anchorTxId: 'salary_sep',
  createdAt: NOW,
  updatedAt: NOW,
};

interface Row {
  periodId: string;
  type: TransactionType;
  category: Category;
  amount: number;
}

type TypeFilter = TransactionType | { in: TransactionType[] } | undefined;

function typeMatches(type: TransactionType, filter: TypeFilter): boolean {
  if (filter === undefined) return true;
  if (typeof filter === 'string') return type === filter;
  return filter.in.includes(type);
}

const decimal = (value: number) => new Prisma.Decimal(value);

function fakeClient(rows: Row[]) {
  const ledgers = new Map<string, PeriodLedger>();
  const budgets = new Map<
    string,
    { limitAmount?: unknown; spentAmount?: unknown }
  >();
  const select = (where: { periodId: string; type?: TypeFilter }) =>
    rows.filter(
      (row) =>
        row.periodId === where.periodId && typeMatches(row.type, where.type),
    );

  const client = {
    financialPeriod: { findMany: jest.fn().mockResolvedValue([CLOSED, OPEN]) },
    periodLedger: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(
        ({
          create,
        }: {
          create: Omit<PeriodLedger, 'id' | 'createdAt' | 'updatedAt'>;
        }) => {
          const ledger = {
            ...create,
            id: create.periodId,
            createdAt: NOW,
            updatedAt: NOW,
          };
          ledgers.set(create.periodId, ledger);
          return Promise.resolve(ledger);
        },
      ),
    },
    transaction: {
      aggregate: jest.fn(
        ({ where }: { where: { periodId: string; type?: TypeFilter } }) => {
          const matched = select(where);
          return Promise.resolve({
            _sum: {
              amount: matched.length
                ? decimal(matched.reduce((sum, row) => sum + row.amount, 0))
                : null,
            },
          });
        },
      ),
      groupBy: jest.fn(
        ({ where }: { where: { periodId: string; type?: TypeFilter } }) => {
          const byCategory = new Map<Category, number>();
          for (const row of select(where)) {
            byCategory.set(
              row.category,
              (byCategory.get(row.category) ?? 0) + row.amount,
            );
          }
          return Promise.resolve(
            [...byCategory].map(([category, amount]) => ({
              category,
              _sum: { amount: decimal(amount) },
            })),
          );
        },
      ),
    },
    goalContribution: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
    },
    recurringExpense: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { category: Category.HOUSING, estimatedAmount: decimal(1_650_000) },
        ]),
    },
    budgetRule: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { category: Category.OTHER, targetPercentage: decimal(10) },
        ]),
    },
    goal: { findMany: jest.fn().mockResolvedValue([]) },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: USER_ID,
        targetSavingsPercentage: decimal(30),
      }),
    },
    budget: {
      upsert: jest.fn(
        ({
          where,
          update,
        }: {
          where: {
            userId_periodId_category: { periodId: string; category: Category };
          };
          update: { limitAmount?: unknown; spentAmount?: unknown };
        }) => {
          const key = `${where.userId_periodId_category.periodId}:${where.userId_periodId_category.category}`;
          budgets.set(key, { ...budgets.get(key), ...update });
          return Promise.resolve(undefined);
        },
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };

  return {
    client: client as unknown as Prisma.TransactionClient,
    ledgers,
    budgets,
  };
}

const ROWS: Row[] = [
  // Closed period: salary, a regular expense and a huge transfer (card payment).
  {
    periodId: CLOSED.id,
    type: TransactionType.INCOME,
    category: Category.SALARY,
    amount: 2_000_000,
  },
  {
    periodId: CLOSED.id,
    type: TransactionType.EXPENSE,
    category: Category.FOOD,
    amount: 500_000,
  },
  {
    periodId: CLOSED.id,
    type: TransactionType.TRANSFER,
    category: Category.OTHER,
    amount: 20_000_000,
  },
  // Current period: salary, an expense and two more transfers.
  {
    periodId: OPEN.id,
    type: TransactionType.INCOME,
    category: Category.SALARY,
    amount: 1_000_000,
  },
  {
    periodId: OPEN.id,
    type: TransactionType.EXPENSE,
    category: Category.FOOD,
    amount: 100_000,
  },
  {
    periodId: OPEN.id,
    type: TransactionType.TRANSFER,
    category: Category.OTHER,
    amount: 838_675,
  },
  {
    periodId: OPEN.id,
    type: TransactionType.TRANSFER,
    category: Category.OTHER,
    amount: 4_539_024,
  },
];

function services() {
  const createOnce = jest.fn().mockResolvedValue(undefined);
  const incomeCalculator = new IncomeCalculatorService();
  const periodLedger = new PeriodLedgerService(incomeCalculator);
  const budgets = new BudgetRecalculationService(
    periodLedger,
    {} as FinancialPeriodService,
    { createOnce } as unknown as AlertsService,
  );
  return { incomeCalculator, periodLedger, budgets, createOnce };
}

describe('TRANSFER stays out of ledger, income, budgets and alerts', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('ledger: transfers are neither income nor expenses, and the rollover ignores them', async () => {
    const { periodLedger } = services();
    const { client } = fakeClient(ROWS);

    const [closed, open] = await periodLedger.recalculateLedgerCascade(
      client,
      USER_ID,
      CLOSED.startDate,
    );

    expect(closed.income.toNumber()).toBe(2_000_000);
    expect(closed.expenses.toNumber()).toBe(500_000);
    expect(closed.closingBalance.toNumber()).toBe(1_500_000);
    expect(open.openingBalance.toNumber()).toBe(1_500_000);
    expect(open.income.toNumber()).toBe(1_000_000);
    expect(open.expenses.toNumber()).toBe(100_000);
    expect(open.closingBalance.toNumber()).toBe(2_400_000);
  });

  it('effective income: only INCOME counts', async () => {
    const { incomeCalculator } = services();
    const { client } = fakeClient(ROWS);

    const income = await incomeCalculator.getEffectiveIncome(
      client,
      USER_ID,
      OPEN.id,
    );

    expect(income.toNumber()).toBe(1_000_000);
  });

  it('budgets: transfers consume no category (not even OTHER)', async () => {
    const { budgets: service } = services();
    const { client, budgets } = fakeClient(ROWS);

    await service.recalculateFrom(client, USER_ID, CLOSED.startDate);

    expect(budgets.get(`${OPEN.id}:FOOD`)?.spentAmount).toEqual(
      decimal(100_000),
    );
    expect(budgets.get(`${OPEN.id}:OTHER`)?.spentAmount).toBeUndefined();
    // Base = 1.500.000 rollover + 1.000.000 income − 1.650.000 fixed = 850.000.
    expect(budgets.get(`${OPEN.id}:OTHER`)?.limitAmount).toEqual(
      decimal(85_000),
    );
  });

  it('deficit alert: a transfer larger than the whole income does not trigger it', async () => {
    const { budgets: service, createOnce } = services();
    const { client } = fakeClient(ROWS);

    await service.recalculateFrom(client, USER_ID, CLOSED.startDate);

    expect(createOnce).not.toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      AlertType.PERIOD_DEFICIT,
      expect.anything(),
      expect.anything(),
    );
  });
});
