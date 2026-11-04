import { Category, Prisma, TransactionType } from '@prisma/client';
import type { CurrentUserService } from '@common/services/current-user.service';
import type { FinancialPeriodService } from '@modules/financial-periods/financial-period.service';
import type { PrismaService } from '@modules/prisma/prisma.service';
import { ReportsService } from './reports.service';

const USER_ID = 'user_1';
const PERIOD_ID = 'period_1';

interface Row {
  type: TransactionType;
  category: Category;
  amount: number;
}

type TypeFilter =
  | TransactionType
  | { in: TransactionType[] }
  | { not: TransactionType }
  | { notIn: TransactionType[] }
  | undefined;

function typeMatches(type: TransactionType, filter: TypeFilter): boolean {
  if (filter === undefined) return true;
  if (typeof filter === 'string') return type === filter;
  if ('in' in filter) return filter.in.includes(type);
  if ('notIn' in filter) return !filter.notIn.includes(type);
  return type !== filter.not;
}

/** In-memory `groupBy`/`aggregate` over one period's transactions. */
function fakeTransactions(rows: Row[]) {
  const select = (where: { type?: TypeFilter }) =>
    rows.filter((row) => typeMatches(row.type, where.type));

  return {
    aggregate: jest.fn(({ where }: { where: { type?: TypeFilter } }) => {
      const matched = select(where);
      return Promise.resolve({
        _sum: {
          amount: matched.length
            ? new Prisma.Decimal(
                matched.reduce((sum, row) => sum + row.amount, 0),
              )
            : null,
        },
      });
    }),
    groupBy: jest.fn(
      ({
        where,
        _count,
        take,
      }: {
        where: { type?: TypeFilter };
        _count?: unknown;
        take?: number;
      }) => {
        const groups = new Map<Category, { amount: number; count: number }>();
        for (const row of select(where)) {
          const group = groups.get(row.category) ?? { amount: 0, count: 0 };
          group.amount += row.amount;
          group.count += 1;
          groups.set(row.category, group);
        }
        const sorted = [...groups.entries()].sort(([, a], [, b]) =>
          _count ? b.count - a.count : b.amount - a.amount,
        );
        return Promise.resolve(
          sorted.slice(0, take ?? sorted.length).map(([category, group]) => ({
            category,
            _sum: { amount: new Prisma.Decimal(group.amount) },
            _count: { category: group.count },
          })),
        );
      },
    ),
  };
}

const ROWS: Row[] = [
  { type: TransactionType.EXPENSE, category: Category.FOOD, amount: 120_000 },
  { type: TransactionType.EXPENSE, category: Category.FOOD, amount: 80_000 },
  { type: TransactionType.EXPENSE, category: Category.HEALTH, amount: 104_900 },
  // Three card payments: more rows and more money than any expense category.
  { type: TransactionType.TRANSFER, category: Category.OTHER, amount: 838_675 },
  {
    type: TransactionType.TRANSFER,
    category: Category.OTHER,
    amount: 1_033_737,
  },
  {
    type: TransactionType.TRANSFER,
    category: Category.OTHER,
    amount: 4_539_024,
  },
];

function setup(rows: Row[] = ROWS) {
  const transaction = fakeTransactions(rows);
  const prisma = {
    transaction,
    budget: { findUnique: jest.fn().mockResolvedValue(null) },
    goalContribution: {
      findMany: jest.fn().mockResolvedValue([
        {
          amount: new Prisma.Decimal(500_000),
          contributedAt: new Date('2026-10-05T17:00:00Z'),
        },
      ]),
    },
    goal: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new ReportsService(
    prisma as unknown as PrismaService,
    {
      getUserId: jest.fn().mockResolvedValue(USER_ID),
    } as unknown as CurrentUserService,
    {
      resolvePeriod: jest.fn().mockResolvedValue({ id: PERIOD_ID }),
    } as unknown as FinancialPeriodService,
  );
  return { service, transaction };
}

describe('ReportsService — las transferencias no cuentan', () => {
  it('resumen: ni gasto más grande ni categoría más frecuente', async () => {
    const { service } = setup();

    const summary = await service.getSummary(PERIOD_ID);

    expect(summary.biggestExpense).toEqual({
      category: Category.FOOD,
      amount: 200_000,
    });
    expect(summary.mostFrequentCategory).toEqual({
      category: Category.FOOD,
      count: 2,
    });
    expect(summary.savingsProgress.actual).toBe(0);
  });

  it('distribución: solo gastos, sin OTHER de las transferencias', async () => {
    const { service } = setup();

    const distribution = await service.getDistribution(PERIOD_ID);

    expect(distribution.map((item) => [item.category, item.amount])).toEqual([
      [Category.FOOD, 200_000],
      [Category.HEALTH, 104_900],
    ]);
    expect(
      distribution.reduce((sum, item) => sum + item.percentage, 0),
    ).toBeCloseTo(100, 0);
  });

  it('una compra a cuotas (FINANCED_PURCHASE) tampoco: su gasto son las cuotas', async () => {
    const financed = (amount: number) => ({
      type: TransactionType.FINANCED_PURCHASE,
      category: Category.PERSONAL,
      amount,
    });
    const { service } = setup([
      ...ROWS,
      financed(6_999_000),
      financed(1_605_708),
      financed(93_900),
    ]);

    const summary = await service.getSummary(PERIOD_ID);

    expect(summary.biggestExpense?.category).toBe(Category.FOOD);
    expect(summary.mostFrequentCategory).toEqual({
      category: Category.FOOD,
      count: 2,
    });
  });

  it('proyección de ahorro: sale de los aportes a metas, no de transacciones', async () => {
    const { service, transaction } = setup();

    const projection = await service.getSavingsProjection();

    expect(transaction.aggregate).not.toHaveBeenCalled();
    expect(transaction.groupBy).not.toHaveBeenCalled();
    expect(projection.points.map((point) => point.cumulativeAmount)).toEqual([
      500_000,
    ]);
  });
});
