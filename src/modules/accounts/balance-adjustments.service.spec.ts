import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountType,
  BalanceAdjustmentReason,
  Prisma,
  TransactionType,
  type Account,
  type AccountBalanceAdjustment,
} from '@prisma/client';
import type { CurrentUserService } from '@common/services/current-user.service';
import type { PrismaService } from '@modules/prisma/prisma.service';
import { AccountsService } from './accounts.service';
import {
  ACCOUNT_STATEMENT_FIELDS_MESSAGE,
  ADJUSTMENT_ALREADY_REVERTED_MESSAGE,
  ADJUSTMENT_NOT_CURRENT_MESSAGE,
  BalanceAdjustmentsService,
  CARD_STATEMENT_FIELDS_MESSAGE,
} from './balance-adjustments.service';

const USER_ID = 'user_1';
const OLD_ANCHOR = new Date('2026-09-18T10:24:56Z');
/** 4/11/2026 at noon in Bogotá. */
const NOW = new Date('2026-11-04T17:00:00Z');
const decimal = (value: number) => new Prisma.Decimal(value);

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
  accountId: string,
  date: string,
  toAccountId: string | null = null,
): Row => ({
  type,
  amount,
  accountId,
  toAccountId,
  transactionDate: new Date(date),
});

function account(overrides: Partial<Account> & Pick<Account, 'id'>): Account {
  return {
    userId: USER_ID,
    name: overrides.id,
    type: AccountType.CREDIT_CARD,
    initialBalance: decimal(0),
    initialBalanceDate: OLD_ANCHOR,
    institutionId: null,
    hasDebitCard: false,
    cardLast4: null,
    creditLimit: null,
    statementDay: null,
    paymentDueDay: null,
    defaultMonthlyRate: null,
    createdAt: OLD_ANCHOR,
    updatedAt: OLD_ANCHOR,
    ...overrides,
  };
}

/** TC VISA as it is today: the anchor is the available credit on 18/09. */
const VISA = () =>
  account({
    id: 'visa',
    name: 'TC VISA Clásica',
    initialBalance: decimal(1_766_523),
    statementDay: 31,
    paymentDueDay: 17,
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

/** In-memory accounts, transactions and adjustment history. */
function setup(accounts: Account[], transactions: Row[] = []) {
  const accountRows = accounts.map((item) => ({ ...item }));
  const adjustments: AccountBalanceAdjustment[] = [];
  let clock = 0;
  const withRevert = (row: AccountBalanceAdjustment) => {
    const revertedBy = adjustments.find((other) => other.revertsId === row.id);
    return { ...row, revertedBy: revertedBy ? { id: revertedBy.id } : null };
  };

  const client = {
    account: {
      // Copies, like Prisma: the service must not see its own later writes.
      findFirst: jest.fn(
        ({ where }: { where: { id: string; userId: string } }) => {
          const row = accountRows.find(
            (item) => item.id === where.id && item.userId === where.userId,
          );
          return Promise.resolve(row ? { ...row } : null);
        },
      ),
      findMany: jest.fn(() =>
        Promise.resolve(
          accountRows.map((row) => ({ ...row, institution: null })),
        ),
      ),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<Account>;
        }) => {
          const row = accountRows.find((item) => item.id === where.id)!;
          Object.assign(row, data);
          return Promise.resolve({ ...row, institution: null });
        },
      ),
    },
    accountBalanceAdjustment: {
      create: jest.fn(({ data }: { data: AccountBalanceAdjustment }) => {
        const row = {
          ...data,
          id: `adj_${adjustments.length + 1}`,
          // Distinct, increasing timestamps for the history order.
          createdAt: new Date(NOW.getTime() + clock++ * 1000),
        };
        adjustments.push(row);
        return Promise.resolve(withRevert(row));
      }),
      findFirst: jest.fn(
        ({ where }: { where: { id: string; accountId: string } }) => {
          const row = adjustments.find(
            (item) =>
              item.id === where.id && item.accountId === where.accountId,
          );
          return Promise.resolve(row ? withRevert(row) : null);
        },
      ),
      findMany: jest.fn(({ where }: { where: { accountId: string } }) =>
        Promise.resolve(
          adjustments
            .filter((row) => row.accountId === where.accountId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map(withRevert),
        ),
      ),
    },
    transaction: {
      aggregate: jest.fn(({ where }: { where: AggregateWhere }) => {
        const rows = transactions.filter((row) => matches(row, where));
        return Promise.resolve({
          _sum: {
            amount: rows.length
              ? rows.reduce((sum, row) => sum.plus(row.amount), decimal(0))
              : null,
          },
        });
      }),
    },
  };
  const prisma = {
    ...client,
    $transaction: jest.fn((fn: (tx: typeof client) => Promise<unknown>) =>
      fn(client),
    ),
  } as unknown as PrismaService;
  const currentUser = {
    getUserId: jest.fn().mockResolvedValue(USER_ID),
  } as unknown as CurrentUserService;
  const accountsService = new AccountsService(prisma, currentUser);

  return {
    service: new BalanceAdjustmentsService(
      prisma,
      currentUser,
      accountsService,
    ),
    accountsService,
    accountRows,
    adjustments,
  };
}

const VISA_STATEMENT = {
  cutDate: '2026-10-31',
  totalDebt: 4_539_024,
  creditLimit: 4_300_000,
};

describe('BalanceAdjustmentsService — anclar una tarjeta al extracto', () => {
  it('TC VISA: −4.539.024 al 1/11 00:00 Bogotá, disponible 0 y sobrecupo 239.024', async () => {
    const { service } = setup(
      [VISA()],
      [tx(TransactionType.EXPENSE, 283_134, 'visa', '2026-10-01T17:00:00Z')],
    );

    const { account, adjustment } = await service.anchorToStatement(
      'visa',
      VISA_STATEMENT,
      NOW,
    );

    expect(account).toMatchObject({
      initialBalance: -4_539_024,
      initialBalanceDate: '2026-11-01T05:00:00.000Z',
      currentBalance: -4_539_024,
    });
    expect(account.creditCard).toMatchObject({
      configured: true,
      creditLimit: 4_300_000,
      debt: 4_539_024,
      available: 0,
      overLimit: 239_024,
    });
    expect(adjustment).toMatchObject({
      reason: BalanceAdjustmentReason.STATEMENT,
      oldAmount: 1_766_523,
      oldDate: OLD_ANCHOR.toISOString(),
      newAmount: -4_539_024,
      newDate: '2026-11-01T05:00:00.000Z',
      oldCreditLimit: null,
      newCreditLimit: 4_300_000,
      statementDate: '2026-10-31',
      // Before: the old "available credit" anchor minus the purchase.
      balanceBefore: 1_766_523 - 283_134,
      balanceAfter: -4_539_024,
      revertsId: null,
      revertedById: null,
    });
  });

  it('una compra del día del corte a las 22:30 en Bogotá ya está en el extracto; una del día siguiente no', async () => {
    const { service } = setup(
      [VISA()],
      [
        // 31/10 22:30 Bogotá = 1/11 03:30 UTC: inside the statement.
        tx(TransactionType.EXPENSE, 50_000, 'visa', '2026-11-01T03:30:00Z'),
        // 1/11 00:10 Bogotá: after the cut, it adds to the debt.
        tx(TransactionType.EXPENSE, 100_000, 'visa', '2026-11-01T05:10:00Z'),
      ],
    );

    const { account } = await service.anchorToStatement(
      'visa',
      VISA_STATEMENT,
      NOW,
    );

    expect(account.currentBalance).toBe(-4_639_024);
    expect(account.creditCard).toMatchObject({
      debt: 4_639_024,
      available: 0,
      overLimit: 339_024,
    });
  });

  it('TC Davivienda nueva: deuda 4.670.990, disponible 6.829.010, sin sobrecupo', async () => {
    const { service } = setup([
      account({ id: 'davivienda', initialBalanceDate: null }),
    ]);

    const { account: card } = await service.anchorToStatement(
      'davivienda',
      { cutDate: '2026-10-29', totalDebt: 4_670_990, creditLimit: 11_500_000 },
      NOW,
    );

    expect(card.initialBalanceDate).toBe('2026-10-30T05:00:00.000Z');
    expect(card.creditCard).toMatchObject({
      debt: 4_670_990,
      available: 6_829_010,
      overLimit: 0,
    });
  });

  it('sin creditLimit en el body conserva el cupo que ya tenía', async () => {
    const { service } = setup([
      account({
        id: 'visa',
        initialBalance: decimal(-4_539_024),
        creditLimit: decimal(4_300_000),
      }),
    ]);

    const { account: card, adjustment } = await service.anchorToStatement(
      'visa',
      { cutDate: '2026-11-03', totalDebt: 1_000_000 },
      NOW,
    );

    expect(card.creditCard?.creditLimit).toBe(4_300_000);
    expect(adjustment).toMatchObject({
      oldCreditLimit: 4_300_000,
      newCreditLimit: 4_300_000,
    });
  });

  it('una transferencia posterior al ancla deja el saldo de la tarjeta yendo hacia 0', async () => {
    const { service, accountsService } = setup(
      [VISA(), account({ id: 'ahorros', type: AccountType.SAVINGS_ACCOUNT })],
      [
        tx(
          TransactionType.TRANSFER,
          1_033_737,
          'ahorros',
          '2026-11-15T17:00:00Z',
          'visa',
        ),
      ],
    );

    await service.anchorToStatement('visa', VISA_STATEMENT, NOW);
    const visa = (await accountsService.findAll()).find(
      (item) => item.id === 'visa',
    );

    expect(visa?.currentBalance).toBe(-4_539_024 + 1_033_737);
    expect(visa?.creditCard).toMatchObject({
      debt: 3_505_287,
      available: 794_713,
      overLimit: 0,
    });
  });

  it.each([
    [{ cutDate: '2026-10-31' }],
    [{ totalDebt: 1 }],
    [{ date: '2026-10-31', balance: 1 }],
    [{ ...VISA_STATEMENT, balance: 1 }],
  ])('rechaza en una tarjeta el body %p (400)', async (body) => {
    const { service } = setup([VISA()]);

    await expect(service.anchorToStatement('visa', body, NOW)).rejects.toThrow(
      CARD_STATEMENT_FIELDS_MESSAGE,
    );
  });

  it.each([
    ['2026-11-05', 'cutDate cannot be in the future'],
    ['2026-02-30', 'cutDate is not a valid calendar date'],
  ])('rechaza cutDate = %s (400)', async (cutDate, message) => {
    const { service } = setup([VISA()]);

    const call = service.anchorToStatement(
      'visa',
      { cutDate, totalDebt: 1 },
      NOW,
    );

    await expect(call).rejects.toBeInstanceOf(BadRequestException);
    await expect(call).rejects.toThrow(message);
  });

  it('acepta el corte de hoy en Bogotá aunque en UTC ya sea mañana', async () => {
    const { service } = setup([VISA()]);
    // 4/11 21:00 Bogotá = 5/11 02:00 UTC.
    const lateTonight = new Date('2026-11-05T02:00:00Z');

    await expect(
      service.anchorToStatement(
        'visa',
        { cutDate: '2026-11-04', totalDebt: 1 },
        lateTonight,
      ),
    ).resolves.toBeDefined();
  });

  it('una cuenta de otro usuario no existe (404)', async () => {
    const { service } = setup([account({ id: 'ajena', userId: 'user_2' })]);

    await expect(
      service.anchorToStatement('ajena', VISA_STATEMENT, NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('BalanceAdjustmentsService — anclar una cuenta al saldo del banco (B.5)', () => {
  const ahorros = () =>
    account({
      id: 'ahorros',
      type: AccountType.SAVINGS_ACCOUNT,
      initialBalance: decimal(5_199_379.32),
    });

  it('deja el saldo del banco al cierre de ese día', async () => {
    const { service } = setup(
      [ahorros()],
      [
        tx(
          TransactionType.INCOME,
          9_000_000,
          'ahorros',
          '2026-10-01T17:00:00Z',
        ),
        tx(TransactionType.EXPENSE, 20_000, 'ahorros', '2026-11-04T15:00:00Z'),
      ],
    );

    const { account: savings, adjustment } = await service.anchorToStatement(
      'ahorros',
      { date: '2026-11-03', balance: 6_250_000.5 },
      NOW,
    );

    expect(savings).toMatchObject({
      initialBalance: 6_250_000.5,
      initialBalanceDate: '2026-11-04T05:00:00.000Z',
      currentBalance: 6_230_000.5,
      creditCard: null,
    });
    expect(adjustment).toMatchObject({
      balanceBefore: 5_199_379.32 + 9_000_000 - 20_000,
      balanceAfter: 6_230_000.5,
      statementDate: '2026-11-03',
    });
  });

  it.each([
    [{ date: '2026-11-03' }],
    [{ cutDate: '2026-11-03', totalDebt: 1 }],
    [{ date: '2026-11-03', balance: 1, creditLimit: 1 }],
  ])('rechaza el body %p (400)', async (body) => {
    const { service } = setup([ahorros()]);

    await expect(
      service.anchorToStatement('ahorros', body, NOW),
    ).rejects.toThrow(ACCOUNT_STATEMENT_FIELDS_MESSAGE);
  });
});

describe('BalanceAdjustmentsService — historial y reversión', () => {
  it('revertir el ancla de la TC VISA la deja como estaba, sin configurar', async () => {
    const { service } = setup(
      [VISA()],
      [tx(TransactionType.EXPENSE, 283_134, 'visa', '2026-10-01T17:00:00Z')],
    );
    const { adjustment } = await service.anchorToStatement(
      'visa',
      VISA_STATEMENT,
      NOW,
    );

    const { account: card, adjustment: revert } = await service.revert(
      'visa',
      adjustment.id,
    );

    expect(card).toMatchObject({
      initialBalance: 1_766_523,
      initialBalanceDate: OLD_ANCHOR.toISOString(),
      currentBalance: 1_766_523 - 283_134,
    });
    expect(card.creditCard).toMatchObject({ configured: false, debt: null });
    expect(revert).toMatchObject({
      reason: BalanceAdjustmentReason.REVERT,
      revertsId: adjustment.id,
      oldAmount: -4_539_024,
      newAmount: 1_766_523,
      oldCreditLimit: 4_300_000,
      newCreditLimit: null,
      balanceBefore: -4_539_024,
      balanceAfter: 1_766_523 - 283_134,
    });
  });

  it('el historial va del más nuevo al más viejo y marca qué se revirtió', async () => {
    const { service } = setup([VISA()]);
    const { adjustment } = await service.anchorToStatement(
      'visa',
      VISA_STATEMENT,
      NOW,
    );
    const { adjustment: revert } = await service.revert('visa', adjustment.id);

    const history = await service.findAll('visa');

    expect(
      history.map(({ id, reason, revertedById }) => [id, reason, revertedById]),
    ).toEqual([
      [revert.id, BalanceAdjustmentReason.REVERT, null],
      [adjustment.id, BalanceAdjustmentReason.STATEMENT, revert.id],
    ]);
  });

  it('no revierte dos veces el mismo ajuste (409)', async () => {
    const { service } = setup([VISA()]);
    const { adjustment } = await service.anchorToStatement(
      'visa',
      VISA_STATEMENT,
      NOW,
    );
    await service.revert('visa', adjustment.id);

    await expect(service.revert('visa', adjustment.id)).rejects.toThrow(
      ADJUSTMENT_ALREADY_REVERTED_MESSAGE,
    );
  });

  it('con un ancla más nueva, pide revertir primero esa (409); en orden, vuelve al principio', async () => {
    const { service, accountRows } = setup([VISA()]);
    const { adjustment: october } = await service.anchorToStatement(
      'visa',
      VISA_STATEMENT,
      NOW,
    );
    const { adjustment: november } = await service.anchorToStatement(
      'visa',
      { cutDate: '2026-11-03', totalDebt: 3_000_000 },
      NOW,
    );

    const stale = service.revert('visa', october.id);
    await expect(stale).rejects.toBeInstanceOf(ConflictException);
    await expect(stale).rejects.toThrow(ADJUSTMENT_NOT_CURRENT_MESSAGE);

    await service.revert('visa', november.id);
    await service.revert('visa', october.id);
    expect(accountRows[0]).toMatchObject({
      initialBalance: decimal(1_766_523),
      initialBalanceDate: OLD_ANCHOR,
      creditLimit: null,
    });
  });

  it('una reversión también se puede revertir (rehacer)', async () => {
    const { service } = setup([VISA()]);
    const { adjustment } = await service.anchorToStatement(
      'visa',
      VISA_STATEMENT,
      NOW,
    );
    const { adjustment: revert } = await service.revert('visa', adjustment.id);

    const { account: card } = await service.revert('visa', revert.id);

    expect(card.creditCard).toMatchObject({
      debt: 4_539_024,
      overLimit: 239_024,
    });
  });

  it('un ajuste de otra cuenta no existe (404)', async () => {
    const { service } = setup([
      VISA(),
      account({ id: 'otra', initialBalance: decimal(0) }),
    ]);
    const { adjustment } = await service.anchorToStatement(
      'visa',
      VISA_STATEMENT,
      NOW,
    );

    await expect(service.revert('otra', adjustment.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('PATCH initial-balance también deja registro y se puede revertir', async () => {
    const { service } = setup([
      account({ id: 'nequi', type: AccountType.DIGITAL_WALLET }),
    ]);

    const updated = await service.updateInitialBalance('nequi', {
      amount: 1_968.34,
      date: '2026-11-01T05:00:00.000Z',
    });
    const [record] = await service.findAll('nequi');

    expect(updated.currentBalance).toBe(1_968.34);
    expect(record).toMatchObject({
      reason: BalanceAdjustmentReason.INITIAL_BALANCE,
      oldAmount: 0,
      newAmount: 1_968.34,
      statementDate: null,
    });
    await expect(service.revert('nequi', record.id)).resolves.toMatchObject({
      account: {
        initialBalance: 0,
        initialBalanceDate: OLD_ANCHOR.toISOString(),
      },
    });
  });
});
