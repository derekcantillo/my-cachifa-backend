import { BadRequestException } from '@nestjs/common';
import {
  Category,
  LoanStatus,
  Prisma,
  TransactionType,
  type Transaction,
} from '@prisma/client';
import type { CurrentUserService } from '@common/services/current-user.service';
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

const GIVEN: Transaction = {
  id: 'tx_given',
  userId: USER_ID,
  accountId: 'acc_1',
  recurringExpenseId: null,
  loanId: 'loan_1',
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

/**
 * `existing` es lo que devuelve `findOwned`; `account` lo que encuentra la
 * validación de cuenta (`null` = no es del usuario).
 */
function setup(
  existing: LoanWithRepayments,
  account: { id: string } | null = { id: 'acc_2' },
) {
  const loanUpdate = jest.fn(({ data }: { data: object }) =>
    Promise.resolve({ ...existing, ...data }),
  );
  const transactionUpdate = jest.fn(({ data }: { data: object }) =>
    Promise.resolve({ ...GIVEN, ...data }),
  );
  const transactionFindFirst = jest.fn().mockResolvedValue({ id: GIVEN.id });
  const assignTransactionToPeriod = jest.fn().mockResolvedValue({
    period: { id: 'period_oct' },
    affectedFrom: LOAN_DATE,
  });

  const tx = {
    loan: { update: loanUpdate },
    transaction: { findFirst: transactionFindFirst, update: transactionUpdate },
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
  );

  return {
    service,
    prisma,
    loanUpdate,
    transactionFindFirst,
    transactionUpdate,
    assignTransactionToPeriod,
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
