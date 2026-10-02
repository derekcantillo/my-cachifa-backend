import {
  AlertType,
  GoalStatus,
  PlanPhase,
  Prisma,
  type FinancialPeriod,
  type Goal,
  type PeriodLedger,
} from '@prisma/client';
import { AlertsService } from '@modules/alerts/alerts.service';
import { formatCOP } from '@common/utils/currency.util';
import { FinancialPeriodService } from '@modules/financial-periods/financial-period.service';
import { PeriodLedgerService } from '@modules/period-ledger/period-ledger.service';
import { BudgetRecalculationService } from './budget-recalculation.service';

const USER_ID = 'user_1';
const NOW = new Date('2026-10-01T17:00:00Z');

/** Período en curso (`endDate: null`): el único en el que se registran alertas. */
const PERIOD: FinancialPeriod = {
  id: 'period_1',
  userId: USER_ID,
  label: '1 oct 2026 – en curso',
  startDate: new Date('2026-10-01T05:00:00Z'),
  endDate: null,
  anchorTxId: 'tx_1',
  createdAt: NOW,
  updatedAt: NOW,
};

const LEDGER: PeriodLedger = {
  id: 'ledger_1',
  userId: USER_ID,
  periodId: PERIOD.id,
  openingBalance: new Prisma.Decimal(0),
  income: new Prisma.Decimal(1_000_000),
  expenses: new Prisma.Decimal(0),
  savings: new Prisma.Decimal(0),
  closingBalance: new Prisma.Decimal(1_000_000),
  createdAt: NOW,
  updatedAt: NOW,
};

function activeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal_1',
    userId: USER_ID,
    name: 'Carro',
    targetAmount: new Prisma.Decimal(10_000_000),
    currentAmount: new Prisma.Decimal(0),
    targetDate: new Date('2027-01-01'),
    phase: PlanPhase.PHASE_3_VEHICLE_PURCHASE,
    status: GoalStatus.ACTIVE,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function mockClient(goals: Goal[]) {
  const goalFindMany = jest.fn().mockResolvedValue(goals);

  const client = {
    recurringExpense: { findMany: jest.fn().mockResolvedValue([]) },
    budgetRule: { findMany: jest.fn().mockResolvedValue([]) },
    goal: { findMany: goalFindMany },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: USER_ID,
        targetSavingsPercentage: new Prisma.Decimal(30),
      }),
    },
    budget: {
      upsert: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    transaction: { groupBy: jest.fn().mockResolvedValue([]) },
  };

  return {
    goalFindMany,
    client: client as unknown as Prisma.TransactionClient,
  };
}

describe('BudgetRecalculationService — alerta SAVINGS_TARGET_AT_RISK', () => {
  let service: BudgetRecalculationService;
  let createOnce: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    createOnce = jest.fn().mockResolvedValue(undefined);

    service = new BudgetRecalculationService(
      {} as PeriodLedgerService,
      {} as FinancialPeriodService,
      { createOnce } as unknown as AlertsService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('usa el aporte de `calculateGoalPlan`, redondeado hacia arriba', async () => {
    const { client } = mockClient([activeGoal()]);

    await service.recalculateBudgets(client, USER_ID, PERIOD, LEDGER);

    // 10.000.000 restantes / 3 meses (1 oct → 1 ene) = 3.333.334 con el
    // redondeo hacia arriba de `calculateGoalPlan`, no 3.333.333,33.
    expect(createOnce).toHaveBeenCalledWith(
      client,
      USER_ID,
      AlertType.SAVINGS_TARGET_AT_RISK,
      PERIOD.id,
      expect.stringContaining(`${formatCOP(3_333_334)}/mes`),
    );
  });

  it('exige el restante completo de una meta vencida, como antes', async () => {
    const { client } = mockClient([
      activeGoal({
        targetDate: new Date('2026-09-01'),
        currentAmount: new Prisma.Decimal(8_000_000),
      }),
    ]);

    await service.recalculateBudgets(client, USER_ID, PERIOD, LEDGER);

    expect(createOnce).toHaveBeenCalledWith(
      client,
      USER_ID,
      AlertType.SAVINGS_TARGET_AT_RISK,
      PERIOD.id,
      expect.stringContaining(`${formatCOP(2_000_000)}/mes`),
    );
  });

  it('solo consulta metas ACTIVE, así que las pausadas no exigen aporte', async () => {
    const { client, goalFindMany } = mockClient([]);

    await service.recalculateBudgets(client, USER_ID, PERIOD, LEDGER);

    expect(goalFindMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, status: GoalStatus.ACTIVE },
    });
    expect(createOnce).not.toHaveBeenCalled();
  });

  it('no alerta si el aporte requerido cabe en el ahorro recomendado', async () => {
    const { client } = mockClient([
      activeGoal({ targetAmount: new Prisma.Decimal(600_000) }),
    ]);

    // 600.000 / 3 = 200.000, por debajo del 30% de 1.000.000.
    await service.recalculateBudgets(client, USER_ID, PERIOD, LEDGER);

    expect(createOnce).not.toHaveBeenCalled();
  });

  it('no alerta por una meta ya cubierta', async () => {
    const { client } = mockClient([
      activeGoal({ currentAmount: new Prisma.Decimal(10_000_000) }),
    ]);

    await service.recalculateBudgets(client, USER_ID, PERIOD, LEDGER);

    expect(createOnce).not.toHaveBeenCalled();
  });

  it('no registra alertas en un período ya cerrado', async () => {
    const { client } = mockClient([activeGoal()]);

    await service.recalculateBudgets(
      client,
      USER_ID,
      { ...PERIOD, endDate: new Date('2026-11-01T05:00:00Z') },
      LEDGER,
    );

    expect(createOnce).not.toHaveBeenCalled();
  });
});
