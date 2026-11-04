import {
  AlertType,
  Category,
  InstallmentPlanKind,
  InstallmentPlanStatus,
  Prisma,
  type FinancialPeriod,
  type InstallmentPlan,
  type PeriodLedger,
} from '@prisma/client';
import type { AlertsService } from '@modules/alerts/alerts.service';
import type { FinancialPeriodService } from '@modules/financial-periods/financial-period.service';
import type { PeriodLedgerService } from '@modules/period-ledger/period-ledger.service';
import { BudgetRecalculationService } from './budget-recalculation.service';

/**
 * Cuotas de tarjeta en el presupuesto (D.4): la base del período resta el
 * capital de las cuotas que vencen en él (registradas o no) y cada categoría
 * suma las suyas a su límite, como un gasto fijo.
 */

const USER_ID = 'user_1';
const NOW = new Date('2026-11-04T17:00:00Z');
const decimal = (value: number) => new Prisma.Decimal(value);
const date = (value: string) => new Date(`${value}T00:00:00Z`);

/** Open period from the 29/10 salary: it runs until 29/11. */
const PERIOD: FinancialPeriod = {
  id: 'period_nov',
  userId: USER_ID,
  label: '29 oct 2026 – en curso',
  startDate: new Date('2026-10-29T05:00:00Z'),
  endDate: null,
  anchorTxId: 'salary_oct',
  createdAt: NOW,
  updatedAt: NOW,
};

const LEDGER: PeriodLedger = {
  id: 'ledger_nov',
  userId: USER_ID,
  periodId: PERIOD.id,
  openingBalance: decimal(0),
  income: decimal(9_339_050),
  expenses: decimal(0),
  savings: decimal(0),
  closingBalance: decimal(9_339_050),
  createdAt: NOW,
  updatedAt: NOW,
};

const VISA = { statementDay: 31, paymentDueDay: 17 };
const DAVIVIENDA = { statementDay: 29, paymentDueDay: 15 };

type PlanRow = InstallmentPlan & {
  account: { statementDay: number | null; paymentDueDay: number | null };
  transactions: {
    id: string;
    installmentNumber: number | null;
    amount: Prisma.Decimal;
    transactionDate: Date;
  }[];
};

function plan(
  overrides: Partial<PlanRow> & Pick<PlanRow, 'id' | 'account'>,
): PlanRow {
  return {
    userId: USER_ID,
    accountId: 'card',
    kind: InstallmentPlanKind.LEGACY,
    description: overrides.id,
    category: Category.PERSONAL,
    principal: decimal(1_000_000),
    installmentCount: 10,
    monthlyRate: decimal(0),
    startDate: date('2026-01-01'),
    firstStatementDate: date('2026-10-31'),
    billedBeforeTracking: 0,
    recognizeInstallments: true,
    status: InstallmentPlanStatus.ACTIVE,
    settledAt: null,
    settlementInstallment: null,
    createdAt: NOW,
    updatedAt: NOW,
    transactions: [],
    ...overrides,
  };
}

const CELULAR = plan({
  id: 'celular',
  account: DAVIVIENDA,
  principal: decimal(6_999_000),
  installmentCount: 24,
  firstStatementDate: date('2026-02-28'),
  billedBeforeTracking: 8,
});
const AMPLIACION = plan({
  id: 'ampliacion',
  account: VISA,
  kind: InstallmentPlanKind.REFINANCE,
  category: Category.DEBT,
  principal: decimal(2_016_132.08),
  installmentCount: 12,
  monthlyRate: decimal(1.9915),
  firstStatementDate: date('2026-04-30'),
  billedBeforeTracking: 6,
});
const COMPRA_OCTUBRE = plan({
  id: 'compra',
  account: VISA,
  principal: decimal(1_605_708),
  installmentCount: 36,
  monthlyRate: decimal(2.1155),
  startDate: date('2026-10-12'),
});

function setup(plans: PlanRow[]) {
  const limits = new Map<Category, Prisma.Decimal>();
  const client = {
    recurringExpense: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { category: Category.HOUSING, estimatedAmount: decimal(1_650_000) },
        ]),
    },
    budgetRule: {
      findMany: jest.fn().mockResolvedValue([
        { category: Category.OTHER, targetPercentage: decimal(10) },
        { category: Category.PERSONAL, targetPercentage: decimal(5) },
      ]),
    },
    goal: { findMany: jest.fn().mockResolvedValue([]) },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: USER_ID,
        targetSavingsPercentage: decimal(30),
      }),
    },
    installmentPlan: { findMany: jest.fn().mockResolvedValue(plans) },
    budget: {
      upsert: jest.fn(
        ({
          where,
          update,
        }: {
          where: { userId_periodId_category: { category: Category } };
          update: { limitAmount?: Prisma.Decimal };
        }) => {
          if (update.limitAmount) {
            limits.set(
              where.userId_periodId_category.category,
              update.limitAmount,
            );
          }
          return Promise.resolve(undefined);
        },
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    transaction: { groupBy: jest.fn().mockResolvedValue([]) },
  };
  const createOnce = jest.fn().mockResolvedValue(undefined);
  const service = new BudgetRecalculationService(
    {} as PeriodLedgerService,
    {} as FinancialPeriodService,
    { createOnce } as unknown as AlertsService,
  );
  const recalculate = () =>
    service.recalculateBudgets(
      client as unknown as Prisma.TransactionClient,
      USER_ID,
      PERIOD,
      LEDGER,
    );
  const limit = (category: Category) => limits.get(category)?.toNumber();
  return { recalculate, limit, createOnce };
}

describe('Presupuesto con cuotas de tarjeta', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('la base resta las cuotas que vencen en el período y cada categoría suma las suyas', async () => {
    const { recalculate, limit } = setup([CELULAR, AMPLIACION, COMPRA_OCTUBRE]);

    await recalculate();

    // Base = 9.339.050 − 1.650.000 (fijos) − 291.625 − 168.011,01 − 44.603.
    const base = 9_339_050 - 1_650_000 - 291_625 - 168_011.01 - 44_603;
    expect(limit(Category.OTHER)).toBeCloseTo(base * 0.1, 2);
    expect(limit(Category.PERSONAL)).toBeCloseTo(
      base * 0.05 + 291_625 + 44_603,
      2,
    );
    // DEBT has no rule and no fixed expense: its limit is just the installment.
    expect(limit(Category.DEBT)).toBe(168_011.01);
    expect(limit(Category.HOUSING)).toBe(1_650_000);
  });

  it('una cuota ya registrada cuenta por la fecha de su gasto (no se resta dos veces)', async () => {
    const { recalculate, limit } = setup([
      {
        ...CELULAR,
        transactions: [
          {
            id: 'tx_9',
            installmentNumber: 9,
            amount: decimal(291_625),
            transactionDate: new Date('2026-11-15T17:00:00Z'),
          },
        ],
      },
    ]);

    await recalculate();

    const base = 9_339_050 - 1_650_000 - 291_625;
    expect(limit(Category.PERSONAL)).toBeCloseTo(base * 0.05 + 291_625, 2);
  });

  it('no cuentan: planes sin gasto por cuota, cuotas futuras ni las pagadas antes de rastrear', async () => {
    const { recalculate, limit } = setup([
      { ...AMPLIACION, recognizeInstallments: false },
      // Installment 1 is billed on 30/11 and due on 17/12: next period.
      plan({
        id: 'futura',
        account: VISA,
        category: Category.EDUCATION,
        firstStatementDate: date('2026-11-30'),
      }),
      // "9/24" with 9 marked as paid before tracking: nothing due now.
      { ...CELULAR, billedBeforeTracking: 9 },
    ]);

    await recalculate();

    expect(limit(Category.DEBT)).toBeUndefined();
    expect(limit(Category.EDUCATION)).toBeUndefined();
    expect(limit(Category.OTHER)).toBeCloseTo((9_339_050 - 1_650_000) * 0.1, 2);
  });

  it('liquidado: cuenta el gasto de la liquidación en su fecha y ninguna cuota más', async () => {
    const { recalculate, limit } = setup([
      {
        ...CELULAR,
        status: InstallmentPlanStatus.SETTLED,
        settledAt: date('2026-11-04'),
        settlementInstallment: 9,
        transactions: [
          {
            id: 'tx_settle',
            installmentNumber: 9,
            amount: decimal(4_666_000),
            transactionDate: new Date('2026-11-04T17:00:00Z'),
          },
        ],
      },
    ]);

    await recalculate();

    const base = 9_339_050 - 1_650_000 - 4_666_000;
    expect(limit(Category.PERSONAL)).toBeCloseTo(base * 0.05 + 4_666_000, 2);
  });

  it('si las cuotas dejan la base en negativo, alerta de déficit que las menciona', async () => {
    const { recalculate, createOnce } = setup([
      plan({
        id: 'grande',
        account: VISA,
        principal: decimal(80_000_000),
        installmentCount: 10,
      }),
    ]);

    await recalculate();

    expect(createOnce).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      AlertType.PERIOD_DEFICIT,
      PERIOD.id,
      expect.stringContaining('menos gastos fijos y cuotas'),
    );
  });
});
