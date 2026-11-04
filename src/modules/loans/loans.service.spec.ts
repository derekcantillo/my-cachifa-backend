import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  Category,
  LoanStatus,
  Prisma,
  TransactionType,
  type LoanRepayment,
  type Transaction,
} from '@prisma/client';
import type { CurrentUserService } from '@common/services/current-user.service';
import type { BudgetRecalculationService } from '@modules/budgets/budget-recalculation.service';
import type { FinancialPeriodService } from '@modules/financial-periods/financial-period.service';
import type { PrismaService } from '@modules/prisma/prisma.service';
import type { LoanWithRepayments } from './interfaces/loan-response.interface';
import { LoansService } from './loans.service';

const USER_ID = 'user_1';
const LOAN_DATE = new Date('2026-09-10T17:00:00Z');

function loan(overrides: Partial<LoanWithRepayments> = {}): LoanWithRepayments {
  return {
    id: 'loan_1',
    userId: USER_ID,
    borrowerName: 'Ana',
    amount: new Prisma.Decimal(1_000_000),
    amountRepaid: new Prisma.Decimal(0),
    status: LoanStatus.ACTIVE,
    loanDate: LOAN_DATE,
    dueDate: null,
    note: null,
    accountId: 'acc_1',
    createdAt: LOAN_DATE,
    updatedAt: LOAN_DATE,
    repayments: [],
    ...overrides,
  };
}

function repayment(
  id: string,
  amount: number,
  paidAt = '2026-09-20T17:00:00Z',
): LoanRepayment {
  return {
    id,
    loanId: 'loan_1',
    amount: new Prisma.Decimal(amount),
    paidAt: new Date(paidAt),
    note: null,
    createdAt: new Date(paidAt),
  };
}

const GIVEN: Transaction = {
  id: 'tx_given',
  userId: USER_ID,
  accountId: 'acc_1',
  toAccountId: null,
  recurringExpenseId: null,
  loanId: 'loan_1',
  loanRepaymentId: null,
  installmentPlanId: null,
  installmentNumber: null,
  amount: new Prisma.Decimal(1_000_000),
  type: TransactionType.LOAN_GIVEN,
  category: Category.LOAN,
  description: 'Préstamo a Ana',
  tags: [],
  rawMessage: '',
  transactionDate: LOAN_DATE,
  monthYear: '2026-09',
  budgetPeriod: null,
  periodId: 'period_sep',
  createdAt: LOAN_DATE,
  updatedAt: LOAN_DATE,
};

/** Aplica el `data` de `tx.loan.update`, incluido `{ increment }` / `{ decrement }`. */
function applyLoanData(
  existing: LoanWithRepayments,
  data: Record<string, unknown>,
): LoanWithRepayments {
  const { amountRepaid, ...rest } = data;
  let nextRepaid = existing.amountRepaid;
  if (amountRepaid instanceof Prisma.Decimal) {
    nextRepaid = amountRepaid;
  } else if (amountRepaid && typeof amountRepaid === 'object') {
    const change = amountRepaid as {
      increment?: Prisma.Decimal;
      decrement?: Prisma.Decimal;
    };
    if (change.increment) nextRepaid = nextRepaid.add(change.increment);
    if (change.decrement) nextRepaid = nextRepaid.minus(change.decrement);
  }
  return { ...existing, ...rest, amountRepaid: nextRepaid };
}

/**
 * `existing` es lo que devuelve `findOwned`; `account` lo que encuentra la
 * validación de cuenta (`null` = no es del usuario).
 */
function setup(
  existing: LoanWithRepayments,
  account: { id: string } | null = { id: 'acc_2' },
  rebuiltFrom?: Date,
) {
  const deletedRepayments = new Set<string>();
  const loanUpdate = jest.fn(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({
      ...applyLoanData(existing, data),
      repayments: existing.repayments.filter(
        (item) => !deletedRepayments.has(item.id),
      ),
    }),
  );
  const repaymentDelete = jest.fn(({ where }: { where: { id: string } }) => {
    deletedRepayments.add(where.id);
    return Promise.resolve(undefined);
  });
  const repaymentCreate = jest.fn(({ data }: { data: object }) =>
    Promise.resolve({ id: 'rep_new', createdAt: LOAN_DATE, ...data }),
  );
  const transactionCreate = jest.fn(({ data }: { data: object }) =>
    Promise.resolve({ ...GIVEN, id: 'tx_new', periodId: null, ...data }),
  );
  const transactionUpdate = jest.fn(({ data }: { data: object }) =>
    Promise.resolve({ ...GIVEN, ...data }),
  );
  const transactionFindFirst = jest.fn().mockResolvedValue({ id: GIVEN.id });
  // Por defecto el período ya existía: `affectedFrom` es la fecha del propio
  // movimiento. Con `rebuiltFrom`, simula que hubo que rehacer la secuencia.
  const assignTransactionToPeriod = jest.fn(
    (_client: unknown, transaction: Transaction) =>
      Promise.resolve({
        period: { id: 'period_oct' },
        affectedFrom: rebuiltFrom ?? transaction.transactionDate,
      }),
  );
  const recalculateFrom = jest.fn().mockResolvedValue(undefined);
  const loanCreate = jest.fn(({ data }: { data: object }) =>
    Promise.resolve({ ...existing, ...data }),
  );

  const tx = {
    loan: { create: loanCreate, update: loanUpdate },
    loanRepayment: { create: repaymentCreate, delete: repaymentDelete },
    transaction: {
      findFirst: transactionFindFirst,
      update: transactionUpdate,
      create: transactionCreate,
    },
  };
  const prisma = {
    loan: { findFirst: jest.fn().mockResolvedValue(existing) },
    account: { findFirst: jest.fn().mockResolvedValue(account) },
    $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  };

  const service = new LoansService(
    prisma as unknown as PrismaService,
    {
      getUserId: jest.fn().mockResolvedValue(USER_ID),
    } as unknown as CurrentUserService,
    { assignTransactionToPeriod } as unknown as FinancialPeriodService,
    { recalculateFrom } as unknown as BudgetRecalculationService,
  );

  return {
    service,
    prisma,
    loanUpdate,
    repaymentCreate,
    repaymentDelete,
    transactionCreate,
    transactionFindFirst,
    transactionUpdate,
    assignTransactionToPeriod,
    recalculateFrom,
  };
}

describe('LoansService.update', () => {
  it('rechaza un monto menor a lo ya abonado sin escribir nada', async () => {
    const { service, prisma } = setup(
      loan({
        amountRepaid: new Prisma.Decimal(600_000),
        status: LoanStatus.PARTIALLY_PAID,
      }),
    );

    await expect(
      service.update('loan_1', { amount: 500_000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('pasa a PAID si el monto nuevo iguala lo abonado y corrige el LOAN_GIVEN', async () => {
    const { service, loanUpdate, transactionUpdate } = setup(
      loan({
        amountRepaid: new Prisma.Decimal(500_000),
        status: LoanStatus.PARTIALLY_PAID,
      }),
    );

    const result = await service.update('loan_1', { amount: 500_000 });

    expect(loanUpdate.mock.calls[0][0].data).toMatchObject({
      status: LoanStatus.PAID,
    });
    expect(transactionUpdate).toHaveBeenCalledWith({
      where: { id: GIVEN.id },
      data: { amount: new Prisma.Decimal(500_000) },
    });
    expect(result.status).toBe(LoanStatus.PAID);
    expect(result.remainingAmount).toBe(0);
  });

  it('vuelve de PAID a PARTIALLY_PAID si el monto nuevo supera lo abonado', async () => {
    const { service } = setup(
      loan({
        amountRepaid: new Prisma.Decimal(1_000_000),
        status: LoanStatus.PAID,
      }),
    );

    const result = await service.update('loan_1', { amount: 1_500_000 });

    expect(result.status).toBe(LoanStatus.PARTIALLY_PAID);
    expect(result.remainingAmount).toBe(500_000);
  });

  it('queda ACTIVE si cambia el monto y no hay abonos', async () => {
    const { service } = setup(loan());

    const result = await service.update('loan_1', { amount: 800_000 });

    expect(result.status).toBe(LoanStatus.ACTIVE);
  });

  it('mueve el LOAN_GIVEN de período cuando cambia la fecha', async () => {
    const { service, transactionUpdate, assignTransactionToPeriod } =
      setup(loan());
    const nextDate = '2026-10-05T17:00:00.000Z';

    const result = await service.update('loan_1', { loanDate: nextDate });

    expect(transactionUpdate).toHaveBeenCalledWith({
      where: { id: GIVEN.id },
      data: { transactionDate: new Date(nextDate), monthYear: '2026-10' },
    });
    expect(assignTransactionToPeriod).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: GIVEN.id,
        transactionDate: new Date(nextDate),
      }),
    );
    expect(result.loanDate).toBe(nextDate);
  });

  it('rechaza una cuenta que no es del usuario sin escribir nada', async () => {
    const { service, prisma } = setup(loan(), null);

    await expect(
      service.update('loan_1', { accountId: 'acc_ajena' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('cambia la cuenta y la descripción del LOAN_GIVEN sin reasignar período', async () => {
    const { service, transactionUpdate, assignTransactionToPeriod } =
      setup(loan());

    await service.update('loan_1', {
      accountId: 'acc_2',
      borrowerName: 'Ana M.',
    });

    expect(transactionUpdate).toHaveBeenCalledWith({
      where: { id: GIVEN.id },
      data: { accountId: 'acc_2', description: 'Préstamo a Ana M.' },
    });
    expect(assignTransactionToPeriod).not.toHaveBeenCalled();
  });

  it('no toca el LOAN_GIVEN si solo cambian vencimiento o nota', async () => {
    const { service, transactionFindFirst, transactionUpdate } = setup(loan());

    await service.update('loan_1', {
      dueDate: '2026-12-01T17:00:00.000Z',
      note: 'Paga en diciembre',
    });

    expect(transactionFindFirst).not.toHaveBeenCalled();
    expect(transactionUpdate).not.toHaveBeenCalled();
  });
});

describe('LoansService.addRepayment', () => {
  it('vincula la transacción LOAN_REPAYMENT con el abono que crea', async () => {
    const { service, repaymentCreate, transactionCreate } = setup(loan());

    const result = await service.addRepayment('loan_1', {
      amount: 200_000,
      paidAt: '2026-09-20T17:00:00.000Z',
    });

    expect(repaymentCreate).toHaveBeenCalledTimes(1);
    expect(transactionCreate.mock.calls[0][0].data).toMatchObject({
      type: TransactionType.LOAN_REPAYMENT,
      loanId: 'loan_1',
      loanRepaymentId: 'rep_new',
    });
    expect(result.amountRepaid).toBe(200_000);
    expect(result.status).toBe(LoanStatus.PARTIALLY_PAID);
  });
});

describe('LoansService.removeRepayment', () => {
  it('borra el abono, resta su monto y vuelve de PAID a PARTIALLY_PAID', async () => {
    const { service, repaymentDelete } = setup(
      loan({
        amountRepaid: new Prisma.Decimal(1_000_000),
        status: LoanStatus.PAID,
        repayments: [repayment('rep_1', 600_000), repayment('rep_2', 400_000)],
      }),
    );

    const result = await service.removeRepayment('loan_1', 'rep_2');

    expect(repaymentDelete).toHaveBeenCalledWith({ where: { id: 'rep_2' } });
    expect(result.amountRepaid).toBe(600_000);
    expect(result.remainingAmount).toBe(400_000);
    expect(result.status).toBe(LoanStatus.PARTIALLY_PAID);
    expect(result.repayments.map((item) => item.id)).toEqual(['rep_1']);
  });

  it('vuelve a ACTIVE al borrar el único abono', async () => {
    const { service } = setup(
      loan({
        amountRepaid: new Prisma.Decimal(300_000),
        status: LoanStatus.PARTIALLY_PAID,
        repayments: [repayment('rep_1', 300_000)],
      }),
    );

    const result = await service.removeRepayment('loan_1', 'rep_1');

    expect(result.amountRepaid).toBe(0);
    expect(result.status).toBe(LoanStatus.ACTIVE);
    expect(result.repayments).toEqual([]);
  });

  it('responde 404 si el abono no es de ese préstamo, sin escribir nada', async () => {
    const { service, prisma } = setup(
      loan({ repayments: [repayment('rep_1', 300_000)] }),
    );

    await expect(
      service.removeRepayment('loan_1', 'rep_otro'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('responde 404 si el préstamo no es del usuario', async () => {
    const { service, prisma } = setup(loan());
    prisma.loan.findFirst.mockResolvedValue(null);

    await expect(
      service.removeRepayment('loan_ajeno', 'rep_1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('LoansService — fechas de préstamo y abonos', () => {
  it('PATCH rechaza un loanDate posterior al primer abono', async () => {
    const { service, prisma } = setup(
      loan({
        amountRepaid: new Prisma.Decimal(100_000),
        status: LoanStatus.PARTIALLY_PAID,
        repayments: [
          repayment('rep_2', 50_000, '2026-09-25T17:00:00Z'),
          repayment('rep_1', 50_000, '2026-09-15T17:00:00Z'),
        ],
      }),
    );

    await expect(
      service.update('loan_1', { loanDate: '2026-09-16T17:00:00.000Z' }),
    ).rejects.toThrow(
      'loanDate (2026-09-16) cannot be after the first repayment (2026-09-15)',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('PATCH acepta un loanDate del mismo día que el primer abono, aunque sea más tarde', async () => {
    const { service } = setup(
      loan({
        amountRepaid: new Prisma.Decimal(50_000),
        status: LoanStatus.PARTIALLY_PAID,
        // 8:00 a. m. en Bogotá.
        repayments: [repayment('rep_1', 50_000, '2026-09-15T13:00:00Z')],
      }),
    );

    // 6:00 p. m. del mismo día en Bogotá.
    const result = await service.update('loan_1', {
      loanDate: '2026-09-15T23:00:00.000Z',
    });

    expect(result.loanDate).toBe('2026-09-15T23:00:00.000Z');
  });

  it('addRepayment rechaza un paidAt anterior a loanDate', async () => {
    const { service, prisma } = setup(loan());

    await expect(
      service.addRepayment('loan_1', {
        amount: 50_000,
        paidAt: '2026-09-09T17:00:00.000Z',
      }),
    ).rejects.toThrow(
      'paidAt (2026-09-09) cannot be before the loan date (2026-09-10)',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('addRepayment acepta un abono del mismo día que el préstamo, aunque sea más temprano', async () => {
    const { service, repaymentCreate } = setup(loan());

    // El préstamo es el 10 sep a mediodía (Bogotá); el abono, ese día a las 7:00.
    await service.addRepayment('loan_1', {
      amount: 50_000,
      paidAt: '2026-09-10T12:00:00.000Z',
    });

    expect(repaymentCreate).toHaveBeenCalledTimes(1);
  });

  it('rechaza con BadRequestException', async () => {
    const { service } = setup(loan());

    await expect(
      service.addRepayment('loan_1', {
        amount: 50_000,
        paidAt: '2026-08-01T17:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('LoansService — cascada cuando se rehace la secuencia de períodos', () => {
  /** Inicio del período de arranque rehecho, anterior a cualquier movimiento. */
  const REBUILT_FROM = new Date('2026-08-01T05:00:00Z');

  it('create recalcula desde affectedFrom si es anterior a loanDate', async () => {
    const { service, recalculateFrom } = setup(loan(), undefined, REBUILT_FROM);

    await service.create({
      borrowerName: 'Ana',
      amount: 1_000_000,
      loanDate: '2026-08-15T17:00:00.000Z',
    });

    expect(recalculateFrom).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      REBUILT_FROM,
    );
  });

  it('create no recalcula si el período ya existía', async () => {
    const { service, recalculateFrom } = setup(loan());

    await service.create({
      borrowerName: 'Ana',
      amount: 1_000_000,
      loanDate: '2026-09-10T17:00:00.000Z',
    });

    expect(recalculateFrom).not.toHaveBeenCalled();
  });

  it('addRepayment recalcula desde affectedFrom si es anterior a paidAt', async () => {
    const { service, recalculateFrom } = setup(
      loan({ loanDate: new Date('2026-07-01T17:00:00Z') }),
      undefined,
      REBUILT_FROM,
    );

    await service.addRepayment('loan_1', {
      amount: 50_000,
      paidAt: '2026-08-10T17:00:00.000Z',
    });

    expect(recalculateFrom).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      REBUILT_FROM,
    );
  });

  it('addRepayment no recalcula si el período ya existía', async () => {
    const { service, recalculateFrom } = setup(loan());

    await service.addRepayment('loan_1', {
      amount: 50_000,
      paidAt: '2026-09-20T17:00:00.000Z',
    });

    expect(recalculateFrom).not.toHaveBeenCalled();
  });

  it('update recalcula desde affectedFrom si el nuevo loanDate rehízo la secuencia', async () => {
    const { service, recalculateFrom } = setup(loan(), undefined, REBUILT_FROM);

    await service.update('loan_1', { loanDate: '2026-08-15T17:00:00.000Z' });

    expect(recalculateFrom).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      REBUILT_FROM,
    );
  });

  it('update no recalcula si el período del nuevo loanDate ya existía', async () => {
    const { service, recalculateFrom } = setup(loan());

    await service.update('loan_1', { loanDate: '2026-10-05T17:00:00.000Z' });

    expect(recalculateFrom).not.toHaveBeenCalled();
  });
});
