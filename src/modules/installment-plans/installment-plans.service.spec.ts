import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountType,
  Category,
  InstallmentPlanKind,
  InstallmentPlanStatus,
  Prisma,
  TransactionType,
  type Account,
  type InstallmentPlan,
  type Transaction,
} from '@prisma/client';
import type { CurrentUserService } from '@common/services/current-user.service';
import type { BudgetRecalculationService } from '@modules/budgets/budget-recalculation.service';
import type { FinancialPeriodService } from '@modules/financial-periods/financial-period.service';
import type { PrismaService } from '@modules/prisma/prisma.service';
import type { CreateInstallmentPlanDto } from './dto/create-installment-plan.dto';
import {
  InstallmentPlansService,
  PLAN_BILLED_RANGE_MESSAGE,
  PLAN_CARD_CYCLE_MESSAGE,
  PLAN_CARD_REQUIRED_MESSAGE,
  PLAN_CATEGORY_REQUIRED_MESSAGE,
  PLAN_DELETE_RECOGNIZED_MESSAGE,
  PLAN_FIRST_STATEMENT_MESSAGE,
  PLAN_HAS_RECOGNIZED_MESSAGE,
  PLAN_NOT_RECOGNIZING_MESSAGE,
  PLAN_PURCHASE_BEFORE_ANCHOR_MESSAGE,
  PLAN_RATE_REQUIRED_MESSAGE,
  PLAN_SETTLED_MESSAGE,
  SETTLEMENT_INSTALLMENT_MESSAGE,
} from './installment-plans.service';

const USER_ID = 'user_1';
/** 4/11/2026 at noon in Bogotá. */
const NOW = new Date('2026-11-04T17:00:00Z');
const decimal = (value: number) => new Prisma.Decimal(value);

function card(overrides: Partial<Account> & Pick<Account, 'id'>): Account {
  return {
    userId: USER_ID,
    name: overrides.id,
    type: AccountType.CREDIT_CARD,
    initialBalance: decimal(0),
    initialBalanceDate: null,
    institutionId: null,
    hasDebitCard: false,
    cardLast4: null,
    creditLimit: null,
    statementDay: null,
    paymentDueDay: null,
    defaultMonthlyRate: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** Anchored to the 31/10 statement (1/11 00:00 Bogotá). */
const VISA = card({
  id: 'visa',
  name: 'TC VISA Clásica',
  initialBalance: decimal(-4_539_024),
  initialBalanceDate: new Date('2026-11-01T05:00:00Z'),
  creditLimit: decimal(4_300_000),
  statementDay: 31,
  paymentDueDay: 17,
  defaultMonthlyRate: decimal(2.1155),
});
const DAVIVIENDA = card({
  id: 'davivienda',
  name: 'TC Davivienda',
  initialBalance: decimal(-4_670_990),
  initialBalanceDate: new Date('2026-10-30T05:00:00Z'),
  creditLimit: decimal(11_500_000),
  statementDay: 29,
  paymentDueDay: 15,
});
const SAVINGS = card({ id: 'ahorros', type: AccountType.SAVINGS_ACCOUNT });
const NO_CYCLE = card({ id: 'sin_dias' });

/** The open period, from the 29/10 salary. */
const PERIOD = {
  id: 'period_nov',
  startDate: new Date('2026-10-29T05:00:00Z'),
  endDate: null,
};

type StoredTransaction = Pick<
  Transaction,
  | 'id'
  | 'userId'
  | 'accountId'
  | 'amount'
  | 'type'
  | 'category'
  | 'description'
  | 'transactionDate'
  | 'installmentPlanId'
  | 'installmentNumber'
>;

/** In-memory accounts, plans and transactions behind the service. */
function setup(accounts: Account[] = [VISA, DAVIVIENDA, SAVINGS, NO_CYCLE]) {
  const plans: InstallmentPlan[] = [];
  const transactions: StoredTransaction[] = [];
  const withRelations = (plan: InstallmentPlan) => ({
    ...plan,
    account: accounts.find((item) => item.id === plan.accountId)!,
    transactions: transactions
      .filter((item) => item.installmentPlanId === plan.id)
      .map(({ id, type, installmentNumber, amount, transactionDate }) => ({
        id,
        type,
        installmentNumber,
        amount,
        transactionDate,
      })),
  });
  const defined = <T extends object>(data: T) =>
    Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );

  const client = {
    account: {
      findFirst: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(accounts.find((item) => item.id === where.id) ?? null),
      ),
    },
    installmentPlan: {
      findMany: jest.fn(
        ({
          where,
        }: {
          where: {
            accountId?: string;
            status?: InstallmentPlanStatus;
            recognizeInstallments?: boolean;
          };
        }) =>
          Promise.resolve(
            plans
              .filter(
                (plan) =>
                  (!where.accountId || plan.accountId === where.accountId) &&
                  (!where.status || plan.status === where.status) &&
                  (where.recognizeInstallments === undefined ||
                    plan.recognizeInstallments === where.recognizeInstallments),
              )
              .map(withRelations),
          ),
      ),
      findFirst: jest.fn(({ where }: { where: { id: string } }) => {
        const plan = plans.find((item) => item.id === where.id);
        return Promise.resolve(plan ? withRelations(plan) : null);
      }),
      create: jest.fn(({ data }: { data: Partial<InstallmentPlan> }) => {
        const plan = {
          status: InstallmentPlanStatus.ACTIVE,
          settledAt: null,
          settlementInstallment: null,
          createdAt: NOW,
          updatedAt: NOW,
          ...data,
          id: `plan_${plans.length + 1}`,
        } as InstallmentPlan;
        plans.push(plan);
        return Promise.resolve(plan);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<InstallmentPlan>;
        }) => {
          const plan = plans.find((item) => item.id === where.id)!;
          Object.assign(plan, defined(data));
          return Promise.resolve(plan);
        },
      ),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        plans.splice(
          plans.findIndex((item) => item.id === where.id),
          1,
        );
        // FK cascade: the plan takes its rows with it.
        for (let i = transactions.length - 1; i >= 0; i--) {
          if (transactions[i].installmentPlanId === where.id) {
            transactions.splice(i, 1);
          }
        }
        return Promise.resolve(undefined);
      }),
    },
    transaction: {
      create: jest.fn(({ data }: { data: StoredTransaction }) => {
        const row: StoredTransaction = {
          ...data,
          installmentNumber: data.installmentNumber ?? null,
          id: `tx_${transactions.length + 1}`,
        };
        transactions.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<StoredTransaction>;
        }) => {
          const row = transactions.find((item) => item.id === where.id)!;
          Object.assign(row, defined(data));
          return Promise.resolve(row);
        },
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { installmentPlanId: string };
          data: Partial<StoredTransaction>;
        }) => {
          for (const row of transactions) {
            if (
              row.installmentPlanId === where.installmentPlanId &&
              row.installmentNumber !== null
            ) {
              Object.assign(row, data);
            }
          }
          return Promise.resolve({ count: 0 });
        },
      ),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        transactions.splice(
          transactions.findIndex((item) => item.id === where.id),
          1,
        );
        return Promise.resolve(undefined);
      }),
    },
  };
  const prisma = {
    ...client,
    $transaction: jest.fn((fn: (tx: typeof client) => Promise<unknown>) =>
      fn(client),
    ),
  } as unknown as PrismaService;

  const recalculateFrom = jest.fn().mockResolvedValue(undefined);
  const financialPeriods = {
    resolvePeriod: jest.fn().mockResolvedValue(PERIOD),
    assignTransactionToPeriod: jest.fn((_tx: unknown, row: StoredTransaction) =>
      Promise.resolve({ period: PERIOD, affectedFrom: row.transactionDate }),
    ),
  };
  const service = new InstallmentPlansService(
    prisma,
    {
      getUserId: jest.fn().mockResolvedValue(USER_ID),
    } as unknown as CurrentUserService,
    { recalculateFrom } as unknown as BudgetRecalculationService,
    financialPeriods as unknown as FinancialPeriodService,
  );
  return { service, plans, transactions, recalculateFrom };
}

/** The real plans of both cards (only test data). */
const CELULAR: CreateInstallmentPlanDto = {
  accountId: 'davivienda',
  kind: InstallmentPlanKind.LEGACY,
  description: 'Celular',
  category: Category.PERSONAL,
  principal: 6_999_000,
  installmentCount: 24,
  monthlyRate: 0,
  startDate: '2026-02-10',
  firstStatementDate: '2026-02-28',
  billedBeforeTracking: 8,
};
const AMPLIACION: CreateInstallmentPlanDto = {
  accountId: 'visa',
  kind: InstallmentPlanKind.REFINANCE,
  description: 'Ampliación de plazo',
  category: Category.DEBT,
  principal: 2_016_132.08,
  installmentCount: 12,
  monthlyRate: 1.9915,
  startDate: '2026-04-01',
  firstStatementDate: '2026-04-30',
  billedBeforeTracking: 6,
  recognizeInstallments: true,
};
const COMPRA_OCTUBRE: CreateInstallmentPlanDto = {
  accountId: 'visa',
  kind: InstallmentPlanKind.LEGACY,
  description: 'Compra del 12/10',
  category: Category.PERSONAL,
  principal: 1_605_708,
  installmentCount: 36,
  monthlyRate: 2.1155,
  startDate: '2026-10-12',
};
const NUEVA_COMPRA: CreateInstallmentPlanDto = {
  accountId: 'visa',
  kind: InstallmentPlanKind.PURCHASE,
  description: 'Portátil',
  category: Category.EDUCATION,
  principal: 3_600_000,
  installmentCount: 36,
  startDate: '2026-11-02',
};

beforeEach(() => jest.useFakeTimers({ now: NOW }));
afterEach(() => jest.useRealTimers());

describe('InstallmentPlansService — crear', () => {
  it('PURCHASE: crea el FINANCED_PURCHASE por el monto completo con la tarjeta, con la tasa de la tarjeta', async () => {
    const { service, transactions, recalculateFrom } = setup();

    const plan = await service.create(NUEVA_COMPRA);

    expect(transactions).toEqual([
      expect.objectContaining({
        type: TransactionType.FINANCED_PURCHASE,
        accountId: 'visa',
        amount: decimal(3_600_000),
        category: Category.EDUCATION,
        transactionDate: new Date('2026-11-02T17:00:00Z'),
        installmentPlanId: plan.id,
        installmentNumber: null,
      }),
    ]);
    expect(plan).toMatchObject({
      monthlyRate: 2.1155,
      effectiveAnnualRate: 28.5583,
      recognizeInstallments: true,
      firstStatementDate: '2026-11-30',
      installmentAmount: 100_000,
      currentInstallment: 0,
      remainingPrincipal: 3_600_000,
      financedPurchaseTransactionId: 'tx_1',
      status: 'ACTIVE',
    });
    expect(plan.schedule[0]).toMatchObject({
      statementDate: '2026-11-30',
      dueDate: '2026-12-17',
      state: 'FUTURE',
    });
    expect(recalculateFrom).toHaveBeenCalledTimes(1);
  });

  it('PURCHASE anterior al ancla de la tarjeta: 400, va como LEGACY', async () => {
    const { service, plans } = setup();

    await expect(
      service.create({ ...NUEVA_COMPRA, startDate: '2026-10-31' }),
    ).rejects.toThrow(PLAN_PURCHASE_BEFORE_ANCHOR_MESSAGE);
    expect(plans).toEqual([]);
  });

  it('LEGACY celular Davivienda: sin transacción, va en la 9/24 y quedan 4.374.375', async () => {
    const { service, transactions } = setup();

    const plan = await service.create(CELULAR);

    expect(transactions).toEqual([]);
    expect(plan).toMatchObject({
      installmentAmount: 291_625,
      currentInstallment: 9,
      remainingPrincipal: 4_374_375,
      estimatedRemainingInterest: 0,
      financedPurchaseTransactionId: null,
    });
    expect(plan.schedule[8]).toMatchObject({
      dueDate: '2026-11-15',
      state: 'PENDING',
    });
  });

  it('REFINANCE: por defecto sus cuotas no cuentan como gasto y no pide categoría', async () => {
    const { service, transactions } = setup();

    const plan = await service.create({
      ...AMPLIACION,
      category: undefined,
      recognizeInstallments: undefined,
    });

    expect(transactions).toEqual([]);
    expect(plan.recognizeInstallments).toBe(false);
    expect(plan.schedule[6].state).toBe('NOT_RECOGNIZED');
  });

  it('REFINANCE que cuenta como gasto exige categoría', async () => {
    const { service } = setup();

    await expect(
      service.create({ ...AMPLIACION, category: undefined }),
    ).rejects.toThrow(PLAN_CATEGORY_REQUIRED_MESSAGE);
  });

  it.each([
    [{ accountId: 'ahorros' }, PLAN_CARD_REQUIRED_MESSAGE],
    [{ accountId: 'sin_dias' }, PLAN_CARD_CYCLE_MESSAGE],
    [{ accountId: 'nope' }, 'Account nope not found'],
    [
      { accountId: 'davivienda', monthlyRate: undefined },
      PLAN_RATE_REQUIRED_MESSAGE,
    ],
    [{ billedBeforeTracking: 24 }, PLAN_BILLED_RANGE_MESSAGE],
    [{ firstStatementDate: '2026-01-29' }, PLAN_FIRST_STATEMENT_MESSAGE],
    [{ startDate: '2026-11-05' }, 'startDate cannot be in the future'],
    [{ startDate: '2026-02-30' }, 'startDate is not a valid calendar date'],
  ])('rechaza %p (400)', async (overrides, message) => {
    const { service } = setup();

    const call = service.create({ ...CELULAR, ...overrides });

    await expect(call).rejects.toBeInstanceOf(BadRequestException);
    await expect(call).rejects.toThrow(message);
  });

  it('firstStatementDate vale por su mes: el día es el de corte de la tarjeta', async () => {
    const { service } = setup();

    const plan = await service.create({
      ...CELULAR,
      firstStatementDate: '2026-02-03',
    });

    expect(plan.firstStatementDate).toBe('2026-02-28');
  });
});

describe('InstallmentPlansService — pendientes y registrar', () => {
  async function withRealPlans() {
    const context = setup();
    const celular = await context.service.create(CELULAR);
    const ampliacion = await context.service.create(AMPLIACION);
    const compra = await context.service.create(COMPRA_OCTUBRE);
    await context.service.create({
      ...AMPLIACION,
      description: 'Ampliación sin gasto',
      recognizeInstallments: false,
    });
    context.recalculateFrom.mockClear();
    return { ...context, celular, ampliacion, compra };
  }

  it('lista las cuotas facturadas que vencen en el período, sin las que no cuentan como gasto', async () => {
    const { service } = await withRealPlans();

    const pending = await service.findPending();

    expect(
      pending.map(
        ({ description, number, installmentCount, dueDate, principal }) => [
          description,
          `${number}/${installmentCount}`,
          dueDate,
          principal,
        ],
      ),
    ).toEqual([
      ['Celular', '9/24', '2026-11-15', 291_625],
      ['Ampliación de plazo', '7/12', '2026-11-17', 168_011.01],
      ['Compra del 12/10', '1/36', '2026-11-17', 44_603],
    ]);
    expect(pending[2]).toMatchObject({
      accountName: 'TC VISA Clásica',
      category: Category.PERSONAL,
      estimatedInterest: 33_968.75,
    });
  });

  it('"Registrar todas": un EXPENSE sin cuenta por cuota, con la categoría de la compra y la fecha de pago', async () => {
    const { service, transactions, recalculateFrom } = await withRealPlans();

    const registered = await service.registerPending();

    expect(registered).toHaveLength(3);
    expect(transactions).toEqual([
      expect.objectContaining({
        type: TransactionType.EXPENSE,
        accountId: null,
        amount: decimal(291_625),
        category: Category.PERSONAL,
        description: 'Celular · cuota 9/24',
        transactionDate: new Date('2026-11-15T17:00:00Z'),
        installmentNumber: 9,
      }),
      expect.objectContaining({
        amount: decimal(168_011.01),
        category: Category.DEBT,
        installmentNumber: 7,
      }),
      expect.objectContaining({
        amount: decimal(44_603),
        installmentNumber: 1,
      }),
    ]);
    expect(recalculateFrom).toHaveBeenCalledTimes(1);
    expect(recalculateFrom).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      new Date('2026-11-15T17:00:00Z'),
    );
    await expect(service.findPending()).resolves.toEqual([]);
  });

  it('"Registrar" una cuota y deshacerla', async () => {
    const { service, celular, transactions } = await withRealPlans();

    const detail = await service.recognize(celular.id, 9);
    expect(detail.schedule[8]).toMatchObject({
      state: 'RECOGNIZED',
      transactionId: 'tx_1',
      recognizedAmount: 291_625,
    });

    const undone = await service.unrecognize(celular.id, 9);
    expect(undone.schedule[8].state).toBe('PENDING');
    expect(transactions).toEqual([]);
  });

  it.each([
    [9, ConflictException, 'Installment 9 is already recognized', true],
    [
      10,
      BadRequestException,
      'Installment 10 is not billed yet (cut 2026-11-29)',
      false,
    ],
    [8, BadRequestException, 'was paid before the plan was tracked', false],
    [25, BadRequestException, 'Installment 25 does not exist', false],
  ])(
    'no reconoce la cuota %d',
    async (number, type, message, recognizeFirst) => {
      const { service, celular } = await withRealPlans();
      if (recognizeFirst) await service.recognize(celular.id, 9);

      const call = service.recognize(celular.id, number);

      await expect(call).rejects.toBeInstanceOf(type);
      await expect(call).rejects.toThrow(message);
    },
  );

  it('no reconoce cuotas de un plan que no las cuenta como gasto', async () => {
    const { service, plans } = await withRealPlans();

    await expect(service.recognize(plans[3].id, 7)).rejects.toThrow(
      PLAN_NOT_RECOGNIZING_MESSAGE,
    );
  });

  it('deshacer una cuota no reconocida: 404', async () => {
    const { service, celular } = await withRealPlans();

    await expect(service.unrecognize(celular.id, 9)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('InstallmentPlansService — editar y borrar', () => {
  it('sin cuotas reconocidas cambia monto y fecha, y el FINANCED_PURCHASE los sigue', async () => {
    const { service, transactions } = setup();
    const plan = await service.create(NUEVA_COMPRA);

    const updated = await service.update(plan.id, {
      principal: 3_000_000,
      startDate: '2026-11-03',
    });

    expect(updated.installmentAmount).toBe(83_333.33);
    expect(transactions[0]).toMatchObject({
      amount: decimal(3_000_000),
      transactionDate: new Date('2026-11-03T17:00:00Z'),
    });
  });

  it('con cuotas reconocidas solo cambian descripción, categoría y tasa (y la categoría pasa a las cuotas)', async () => {
    const { service, transactions } = setup();
    const plan = await service.create(CELULAR);
    await service.recognize(plan.id, 9);

    await expect(
      service.update(plan.id, { installmentCount: 12 }),
    ).rejects.toThrow(PLAN_HAS_RECOGNIZED_MESSAGE);

    const updated = await service.update(plan.id, {
      description: 'Celular Samsung',
      category: Category.SERVICES,
      monthlyRate: 1.5,
    });
    expect(updated).toMatchObject({
      description: 'Celular Samsung',
      category: Category.SERVICES,
      monthlyRate: 1.5,
    });
    expect(transactions[0].category).toBe(Category.SERVICES);
  });

  it('no deja sin categoría un plan que cuenta sus cuotas como gasto', async () => {
    const { service } = setup();
    const plan = await service.create(CELULAR);

    await expect(service.update(plan.id, { category: null })).rejects.toThrow(
      PLAN_CATEGORY_REQUIRED_MESSAGE,
    );
  });

  it('DELETE con cuotas reconocidas: 400', async () => {
    const { service, plans } = setup();
    const plan = await service.create(CELULAR);
    await service.recognize(plan.id, 9);

    await expect(service.remove(plan.id)).rejects.toThrow(
      PLAN_DELETE_RECOGNIZED_MESSAGE,
    );
    expect(plans).toHaveLength(1);
  });

  it('DELETE sin cuotas reconocidas se lleva su FINANCED_PURCHASE y recalcula', async () => {
    const { service, plans, transactions, recalculateFrom } = setup();
    const plan = await service.create(NUEVA_COMPRA);
    recalculateFrom.mockClear();

    await service.remove(plan.id);

    expect(plans).toEqual([]);
    expect(transactions).toEqual([]);
    expect(recalculateFrom).toHaveBeenCalledTimes(1);
  });

  it('un plan de otro usuario no existe (404)', async () => {
    const { service } = setup();

    await expect(service.findOne('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('InstallmentPlansService — liquidar', () => {
  it('reconoce de una vez el capital restante y no salen más cuotas', async () => {
    const { service, transactions } = setup();
    const plan = await service.create(CELULAR);

    const settled = await service.settle(plan.id, { settledAt: '2026-11-04' });

    // Installments 9 to 24: 16 × 291.625.
    expect(transactions).toEqual([
      expect.objectContaining({
        type: TransactionType.EXPENSE,
        accountId: null,
        amount: decimal(4_666_000),
        installmentNumber: 9,
        transactionDate: new Date('2026-11-04T17:00:00Z'),
        description: 'Celular · liquidación (cuotas 9-24/24)',
      }),
    ]);
    expect(settled).toMatchObject({
      status: 'SETTLED',
      settledAt: '2026-11-04',
      remainingPrincipal: 0,
    });
    expect(settled.schedule[9].state).toBe('SETTLED');
    await expect(service.findPending()).resolves.toEqual([]);
  });

  it('no se liquida dos veces, ni se deshace su cuota por separado (409)', async () => {
    const { service } = setup();
    const plan = await service.create(CELULAR);
    await service.settle(plan.id, {});

    await expect(service.settle(plan.id, {})).rejects.toThrow(
      PLAN_SETTLED_MESSAGE,
    );
    await expect(service.unrecognize(plan.id, 9)).rejects.toThrow(
      SETTLEMENT_INSTALLMENT_MESSAGE,
    );
    await expect(service.recognize(plan.id, 9)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('deshacer la liquidación borra su gasto y el plan vuelve a ACTIVE', async () => {
    const { service, transactions } = setup();
    const plan = await service.create(CELULAR);
    await service.settle(plan.id, {});

    const restored = await service.unsettle(plan.id);

    expect(transactions).toEqual([]);
    expect(restored).toMatchObject({ status: 'ACTIVE', settledAt: null });
    expect(restored.schedule[8].state).toBe('PENDING');
  });

  it('un plan que no cuenta cuotas como gasto se liquida sin crear gasto', async () => {
    const { service, transactions } = setup();
    const plan = await service.create({
      ...AMPLIACION,
      recognizeInstallments: false,
    });

    await expect(service.settle(plan.id, {})).resolves.toMatchObject({
      status: 'SETTLED',
    });
    expect(transactions).toEqual([]);
  });
});

describe('InstallmentPlansService — listar', () => {
  it('filtra por tarjeta y por estado calculado', async () => {
    const { service } = setup();
    await service.create(CELULAR);
    const compra = await service.create(COMPRA_OCTUBRE);
    await service.settle(compra.id, {});

    const visa = await service.findAll({ accountId: 'visa' });
    const active = await service.findAll({ status: 'ACTIVE' });

    expect(visa.map(({ description }) => description)).toEqual([
      'Compra del 12/10',
    ]);
    expect(active.map(({ description }) => description)).toEqual(['Celular']);
  });
});
