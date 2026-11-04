import { BadRequestException, ConflictException } from '@nestjs/common';
import { Category, Prisma, TransactionType } from '@prisma/client';
import type { CurrentUserService } from '@common/services/current-user.service';
import type { BudgetRecalculationService } from '@modules/budgets/budget-recalculation.service';
import type { FinancialPeriodService } from '@modules/financial-periods/financial-period.service';
import type { PrismaService } from '@modules/prisma/prisma.service';
import type { CreateTransactionDto } from './dto/create-transaction.dto';
import type { UpdateTransactionDto } from './dto/update-transaction.dto';
import type { TransactionWithAccount } from './interfaces/transaction-response.interface';
import { TransactionsService } from './transactions.service';

const USER_ID = 'user_1';
const PERIOD_ID = 'period_1';
const DATE = new Date('2026-10-10T17:00:00Z');
const SAVINGS = 'acc_savings';
const CARD = 'acc_card';
const CASH = 'acc_cash';
const OWNED_ACCOUNTS = [SAVINGS, CARD, CASH];

function transaction(
  overrides: Partial<TransactionWithAccount> = {},
): TransactionWithAccount {
  return {
    id: 'tx_1',
    userId: USER_ID,
    accountId: null,
    toAccountId: null,
    recurringExpenseId: null,
    loanId: null,
    loanRepaymentId: null,
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
    toAccount: null,
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
  ownedAccountIds: readonly string[] = OWNED_ACCOUNTS,
) {
  const transactionUpdate = jest.fn(
    ({ data }: { data: Partial<TransactionWithAccount> }) =>
      Promise.resolve({ ...existing, ...data }),
  );
  const transactionCreate = jest.fn(
    ({ data }: { data: Partial<TransactionWithAccount> }) =>
      Promise.resolve({ ...transaction(), ...data, id: 'tx_new' }),
  );
  const accountFindFirst = jest.fn(({ where }: { where: { id: string } }) =>
    Promise.resolve(
      ownedAccountIds.includes(where.id) ? { id: where.id } : null,
    ),
  );
  const recurringExpenseFindFirst = jest
    .fn()
    .mockResolvedValue(recurringExpense);
  const transactionDelete = jest.fn().mockResolvedValue(existing);
  const recalculateFrom = jest.fn().mockResolvedValue(undefined);

  const tx = {
    transaction: {
      create: transactionCreate,
      update: transactionUpdate,
      delete: transactionDelete,
    },
  };
  const prisma = {
    transaction: { findFirst: jest.fn().mockResolvedValue(existing) },
    account: { findFirst: accountFindFirst },
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
  /** `data` que recibió `tx.transaction.create`. */
  const createData = (): Record<string, unknown> =>
    transactionCreate.mock.calls[0][0].data;

  return {
    service,
    transactionCreate,
    createData,
    transactionUpdate,
    transactionDelete,
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

describe('TransactionsService — movimientos de préstamo', () => {
  const loanMovements: [string, Partial<TransactionWithAccount>][] = [
    [
      'LOAN_GIVEN',
      {
        type: TransactionType.LOAN_GIVEN,
        category: Category.LOAN,
        loanId: 'loan_1',
      },
    ],
    [
      'LOAN_REPAYMENT',
      {
        type: TransactionType.LOAN_REPAYMENT,
        category: Category.LOAN,
        loanId: 'loan_1',
      },
    ],
    ['con loanId aunque el tipo no sea de préstamo', { loanId: 'loan_1' }],
    [
      'de tipo préstamo aunque no tenga loanId',
      { type: TransactionType.LOAN_GIVEN, category: Category.LOAN },
    ],
  ];

  it.each(loanMovements)(
    'PATCH rechaza con 409 un movimiento %s',
    async (_label, overrides) => {
      const { service, transactionUpdate, recalculateFrom } = setup(
        transaction(overrides),
      );

      const update = service.update('tx_1', { description: 'Otro' });

      await expect(update).rejects.toBeInstanceOf(ConflictException);
      await expect(update).rejects.toThrow(
        'Loan movements are managed from /loans',
      );
      expect(transactionUpdate).not.toHaveBeenCalled();
      expect(recalculateFrom).not.toHaveBeenCalled();
    },
  );

  it.each(loanMovements)(
    'DELETE rechaza con 409 un movimiento %s',
    async (_label, overrides) => {
      const { service, transactionDelete, recalculateFrom } = setup(
        transaction(overrides),
      );

      await expect(service.remove('tx_1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(transactionDelete).not.toHaveBeenCalled();
      expect(recalculateFrom).not.toHaveBeenCalled();
    },
  );

  it('DELETE sigue borrando una transacción normal', async () => {
    const { service, transactionDelete, recalculateFrom } =
      setup(transaction());

    await service.remove('tx_1');

    expect(transactionDelete).toHaveBeenCalledWith({ where: { id: 'tx_1' } });
    expect(recalculateFrom).toHaveBeenCalledTimes(1);
  });
});

describe('TransactionsService — transferencias (TRANSFER)', () => {
  const transferDto = (
    overrides: Partial<CreateTransactionDto> = {},
  ): CreateTransactionDto => ({
    amount: 838_675,
    type: TransactionType.TRANSFER,
    accountId: SAVINGS,
    toAccountId: CARD,
    description: 'Pago TC VISA',
    ...overrides,
  });

  const existingTransfer = () =>
    transaction({
      type: TransactionType.TRANSFER,
      category: Category.OTHER,
      accountId: SAVINGS,
      toAccountId: CARD,
      amount: new Prisma.Decimal(838_675),
      description: 'Pago TC VISA',
    });

  it('crea una transferencia con origen y destino y categoría OTHER', async () => {
    const { service, createData, recalculateFrom } = setup(transaction());

    const result = await service.create(
      transferDto({ category: Category.FOOD }),
    );

    expect(createData()).toMatchObject({
      type: TransactionType.TRANSFER,
      accountId: SAVINGS,
      toAccountId: CARD,
      category: Category.OTHER,
      recurringExpenseId: null,
    });
    expect(recalculateFrom).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      type: 'TRANSFER',
      accountId: SAVINGS,
      toAccountId: CARD,
    });
  });

  it('acepta una transferencia sin categoría', async () => {
    const { service, createData } = setup(transaction());

    await service.create(transferDto());

    expect(createData()).toMatchObject({ category: Category.OTHER });
  });

  it.each<[string, Partial<CreateTransactionDto>, string]>([
    [
      'sin destino',
      { toAccountId: undefined },
      'A TRANSFER needs accountId (origin) and toAccountId (destination)',
    ],
    [
      'sin origen',
      { accountId: null },
      'A TRANSFER needs accountId (origin) and toAccountId (destination)',
    ],
    [
      'con la misma cuenta',
      { toAccountId: SAVINGS },
      'A TRANSFER needs two different accounts',
    ],
    [
      'cruzada con un gasto fijo',
      { recurringExpenseId: 're_1' },
      'A TRANSFER cannot be linked to a recurring expense',
    ],
    [
      'hacia una cuenta ajena',
      { toAccountId: 'acc_foreign' },
      'Account acc_foreign not found',
    ],
    [
      'desde una cuenta ajena',
      { accountId: 'acc_foreign' },
      'Account acc_foreign not found',
    ],
  ])(
    'POST rechaza con 400 una transferencia %s',
    async (_label, overrides, message) => {
      const { service, transactionCreate, recalculateFrom } =
        setup(transaction());

      const result = service.create(transferDto(overrides));

      await expect(result).rejects.toBeInstanceOf(BadRequestException);
      await expect(result).rejects.toMatchObject({ message });
      expect(transactionCreate).not.toHaveBeenCalled();
      expect(recalculateFrom).not.toHaveBeenCalled();
    },
  );

  it('POST rechaza toAccountId en un tipo que no es TRANSFER', async () => {
    const { service, transactionCreate } = setup(transaction());

    const result = service.create({
      amount: 50_000,
      type: TransactionType.EXPENSE,
      category: Category.FOOD,
      accountId: SAVINGS,
      toAccountId: CARD,
    });

    await expect(result).rejects.toMatchObject({
      message: 'toAccountId is only allowed on TRANSFER transactions',
    });
    expect(transactionCreate).not.toHaveBeenCalled();
  });

  it('PATCH edita monto, fecha, destino y descripción sin tocar la categoría', async () => {
    const { service, updateData, recalculateFrom } = setup(existingTransfer());

    const result = await service.update('tx_1', {
      amount: 1_033_737,
      transactionDate: '2026-11-17T17:00:00.000Z',
      toAccountId: CASH,
      description: 'Avance',
      category: Category.FOOD,
    });

    const data = updateData();
    expect(data).toMatchObject({
      amount: new Prisma.Decimal(1_033_737),
      transactionDate: new Date('2026-11-17T17:00:00.000Z'),
      toAccountId: CASH,
      description: 'Avance',
    });
    expect(data).not.toHaveProperty('category');
    expect(recalculateFrom).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ toAccountId: CASH, category: 'OTHER' });
  });

  it('PATCH puede cambiar el origen', async () => {
    const { service, updateData } = setup(existingTransfer());

    await service.update('tx_1', { accountId: CASH });

    expect(updateData()).toMatchObject({ accountId: CASH });
  });

  it.each<[string, UpdateTransactionDto, string]>([
    [
      'deja sin origen',
      { accountId: null },
      'A TRANSFER needs accountId (origin) and toAccountId (destination)',
    ],
    [
      'deja sin destino',
      { toAccountId: null },
      'A TRANSFER needs accountId (origin) and toAccountId (destination)',
    ],
    [
      'iguala destino y origen',
      { toAccountId: SAVINGS },
      'A TRANSFER needs two different accounts',
    ],
    [
      'iguala origen y destino',
      { accountId: CARD },
      'A TRANSFER needs two different accounts',
    ],
    [
      'la cruza con un gasto fijo',
      { recurringExpenseId: 're_1' },
      'A TRANSFER cannot be linked to a recurring expense',
    ],
    [
      'la convierte en gasto',
      { type: TransactionType.EXPENSE },
      'A transaction cannot become a TRANSFER or stop being one: delete it and create a new one',
    ],
    [
      'apunta a una cuenta ajena',
      { toAccountId: 'acc_foreign' },
      'Account acc_foreign not found',
    ],
  ])('PATCH rechaza con 400 si %s', async (_label, dto, message) => {
    const { service, transactionUpdate, recalculateFrom } =
      setup(existingTransfer());

    const result = service.update('tx_1', dto);

    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    await expect(result).rejects.toMatchObject({ message });
    expect(transactionUpdate).not.toHaveBeenCalled();
    expect(recalculateFrom).not.toHaveBeenCalled();
  });

  it('PATCH no convierte un gasto en transferencia', async () => {
    const { service, transactionUpdate } = setup(transaction());

    await expect(
      service.update('tx_1', {
        type: TransactionType.TRANSFER,
        toAccountId: CARD,
      }),
    ).rejects.toMatchObject({
      message:
        'A transaction cannot become a TRANSFER or stop being one: delete it and create a new one',
    });
    expect(transactionUpdate).not.toHaveBeenCalled();
  });

  it('PATCH rechaza toAccountId en un gasto', async () => {
    const { service, transactionUpdate } = setup(transaction());

    await expect(
      service.update('tx_1', { toAccountId: CARD }),
    ).rejects.toMatchObject({
      message: 'toAccountId is only allowed on TRANSFER transactions',
    });
    expect(transactionUpdate).not.toHaveBeenCalled();
  });

  it('DELETE borra una transferencia y recalcula', async () => {
    const { service, transactionDelete, recalculateFrom } =
      setup(existingTransfer());

    await service.remove('tx_1');

    expect(transactionDelete).toHaveBeenCalledWith({ where: { id: 'tx_1' } });
    expect(recalculateFrom).toHaveBeenCalledTimes(1);
  });
});
