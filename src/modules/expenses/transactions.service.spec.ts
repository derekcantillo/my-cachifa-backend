import { BadRequestException } from '@nestjs/common';
import { Category, Prisma, TransactionType } from '@prisma/client';
import type { CurrentUserService } from '@common/services/current-user.service';
import type { BudgetRecalculationService } from '@modules/budgets/budget-recalculation.service';
import type { FinancialPeriodService } from '@modules/financial-periods/financial-period.service';
import type { PrismaService } from '@modules/prisma/prisma.service';
import type { UpdateTransactionDto } from './dto/update-transaction.dto';
import type { TransactionWithAccount } from './interfaces/transaction-response.interface';
import { TransactionsService } from './transactions.service';

const USER_ID = 'user_1';
const PERIOD_ID = 'period_1';
const DATE = new Date('2026-10-10T17:00:00Z');

function transaction(
  overrides: Partial<TransactionWithAccount> = {},
): TransactionWithAccount {
  return {
    id: 'tx_1',
    userId: USER_ID,
    accountId: null,
    recurringExpenseId: null,
    loanId: null,
    amount: new Prisma.Decimal(80_000),
    type: TransactionType.EXPENSE,
    category: Category.SERVICES,
    description: 'Internet',
    tags: [],
    rawMessage: 'Internet',
    transactionDate: DATE,
    monthYear: '2026-10',
    budgetPeriod: null,
    periodId: PERIOD_ID,
    createdAt: DATE,
    updatedAt: DATE,
    account: null,
    ...overrides,
  };
}

/**
 * `existing` es lo que devuelve `findOwned`; `recurringExpense` lo que
 * encuentra la validación (`null` = no existe para el usuario).
 */
function setup(
  existing: TransactionWithAccount,
  recurringExpense: { category: Category } | null = null,
) {
  const transactionUpdate = jest.fn(
    ({ data }: { data: Partial<TransactionWithAccount> }) =>
      Promise.resolve({ ...existing, ...data }),
  );
  const recurringExpenseFindFirst = jest
    .fn()
    .mockResolvedValue(recurringExpense);
  const recalculateFrom = jest.fn().mockResolvedValue(undefined);

  const tx = { transaction: { update: transactionUpdate } };
  const prisma = {
    transaction: { findFirst: jest.fn().mockResolvedValue(existing) },
    recurringExpense: { findFirst: recurringExpenseFindFirst },
    $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  };

  const service = new TransactionsService(
    prisma as unknown as PrismaService,
    {
      getUserId: jest.fn().mockResolvedValue(USER_ID),
    } as unknown as CurrentUserService,
    { recalculateFrom } as unknown as BudgetRecalculationService,
    {
      assignTransactionToPeriod: jest.fn().mockResolvedValue({
        period: { id: PERIOD_ID },
        affectedFrom: DATE,
      }),
      recalculatePeriodsFrom: jest.fn(),
    } as unknown as FinancialPeriodService,
  );

  /** `data` que recibió `tx.transaction.update`. */
  const updateData = (): Record<string, unknown> =>
    transactionUpdate.mock.calls[0][0].data;

  return {
    service,
    transactionUpdate,
    recurringExpenseFindFirst,
    recalculateFrom,
    updateData,
  };
}

describe('TransactionsService.update — vínculo con gasto fijo', () => {
  it('cruza la transacción con un gasto fijo de la misma categoría', async () => {
    const { service, recurringExpenseFindFirst, recalculateFrom, updateData } =
      setup(transaction(), { category: Category.SERVICES });

    const result = await service.update('tx_1', {
      recurringExpenseId: 're_1',
    });

    expect(recurringExpenseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 're_1', userId: USER_ID } }),
    );
    expect(updateData()).toMatchObject({ recurringExpenseId: 're_1' });
    expect(recalculateFrom).toHaveBeenCalledTimes(1);
    expect(result.recurringExpenseId).toBe('re_1');
  });

  it('descruza con null sin buscar ningún gasto fijo', async () => {
    const { service, recurringExpenseFindFirst, recalculateFrom, updateData } =
      setup(transaction({ recurringExpenseId: 're_1' }));

    const result = await service.update('tx_1', { recurringExpenseId: null });

    expect(recurringExpenseFindFirst).not.toHaveBeenCalled();
    expect(updateData()).toMatchObject({ recurringExpenseId: null });
    expect(recalculateFrom).toHaveBeenCalledTimes(1);
    expect(result.recurringExpenseId).toBeNull();
  });

  it('rechaza un gasto fijo que no existe y no actualiza nada', async () => {
    const { service, transactionUpdate } = setup(transaction(), null);

    await expect(
      service.update('tx_1', { recurringExpenseId: 're_missing' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactionUpdate).not.toHaveBeenCalled();
  });

  it('no toca el vínculo si el campo no se envía', async () => {
    const { service, recurringExpenseFindFirst, updateData } = setup(
      transaction({ recurringExpenseId: 're_1' }),
    );

    const dto: UpdateTransactionDto = { description: 'Internet fibra' };
    const result = await service.update('tx_1', dto);

    expect(recurringExpenseFindFirst).not.toHaveBeenCalled();
    expect(updateData()).not.toHaveProperty('recurringExpenseId');
    expect(result.recurringExpenseId).toBe('re_1');
  });

  it('valida contra la categoría nueva cuando también cambia', async () => {
    const { service, transactionUpdate } = setup(transaction(), {
      category: Category.SERVICES,
    });

    await expect(
      service.update('tx_1', {
        category: Category.FOOD,
        recurringExpenseId: 're_1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactionUpdate).not.toHaveBeenCalled();
  });
});

describe('TransactionsService.update — cambio de categoría con vínculo existente', () => {
  it('rechaza la categoría nueva si no coincide con el gasto fijo cruzado', async () => {
    const { service, recurringExpenseFindFirst, transactionUpdate } = setup(
      transaction({ recurringExpenseId: 're_1' }),
      { category: Category.SERVICES },
    );

    const update = service.update('tx_1', { category: Category.FOOD });

    await expect(update).rejects.toBeInstanceOf(BadRequestException);
    await expect(update).rejects.toThrow(/recurringExpenseId: null/);
    expect(recurringExpenseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 're_1', userId: USER_ID } }),
    );
    expect(transactionUpdate).not.toHaveBeenCalled();
  });

  it('acepta la categoría nueva si el gasto fijo cruzado es de esa categoría', async () => {
    const { service, updateData } = setup(
      transaction({ recurringExpenseId: 're_1' }),
      { category: Category.FOOD },
    );

    const result = await service.update('tx_1', { category: Category.FOOD });

    expect(updateData()).toMatchObject({ category: Category.FOOD });
    expect(result.recurringExpenseId).toBe('re_1');
  });

  it('no busca gasto fijo si la transacción no está cruzada', async () => {
    const { service, recurringExpenseFindFirst } = setup(transaction());

    await service.update('tx_1', { category: Category.FOOD });

    expect(recurringExpenseFindFirst).not.toHaveBeenCalled();
  });
});
