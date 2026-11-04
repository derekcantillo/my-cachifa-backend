import { BadRequestException } from '@nestjs/common';
import {
  AccountType,
  Prisma,
  type Account,
  type FinancialInstitution,
} from '@prisma/client';
import type { CurrentUserService } from '@common/services/current-user.service';
import type { PrismaService } from '@modules/prisma/prisma.service';
import {
  AccountsService,
  CARD_FIELDS_ONLY_ON_CREDIT_CARD_MESSAGE,
  CARD_LAST4_WITHOUT_CARD_MESSAGE,
  CONFIGURE_WITH_STATEMENT_MESSAGE,
  CREDIT_CARD_TYPE_CHANGE_MESSAGE,
  DEBIT_CARD_NOT_ALLOWED_MESSAGE,
} from './accounts.service';
import type { CreateAccountDto } from './dto/create-account.dto';

/** "Mis productos": entidad, tarjeta débito y últimos 4 dígitos de las cuentas. */

const USER_ID = 'user_1';
const DATE = new Date('2026-09-18T05:00:00Z');

const INSTITUTIONS: FinancialInstitution[] = [
  {
    id: 'bancolombia',
    userId: USER_ID,
    name: 'Bancolombia',
    createdAt: DATE,
    updatedAt: DATE,
  },
  {
    id: 'other_bank',
    userId: 'user_2',
    name: 'Otro banco',
    createdAt: DATE,
    updatedAt: DATE,
  },
];

function stored(overrides: Partial<Account> & Pick<Account, 'id'>): Account {
  return {
    userId: USER_ID,
    name: overrides.id,
    type: AccountType.SAVINGS_ACCOUNT,
    initialBalance: new Prisma.Decimal(0),
    initialBalanceDate: DATE,
    institutionId: null,
    hasDebitCard: false,
    cardLast4: null,
    creditLimit: null,
    statementDay: null,
    paymentDueDay: null,
    defaultMonthlyRate: null,
    createdAt: DATE,
    updatedAt: DATE,
    ...overrides,
  };
}

/**
 * In-memory accounts and institutions. `movements` = transactions that touch
 * each account (as origin or destination); balances are not the point here, so
 * every aggregate is empty.
 */
function setup(
  accounts: Account[] = [],
  movements: Record<string, number> = {},
) {
  const rows = [...accounts];
  const withInstitution = (row: Account) => {
    const institution = INSTITUTIONS.find((i) => i.id === row.institutionId);
    return {
      ...row,
      institution: institution
        ? { id: institution.id, name: institution.name }
        : null,
    };
  };

  const prisma = {
    account: {
      findFirst: jest.fn(
        ({ where }: { where: { id: string; userId: string } }) =>
          Promise.resolve(
            rows.find((r) => r.id === where.id && r.userId === where.userId) ??
              null,
          ),
      ),
      create: jest.fn(({ data }: { data: Partial<Account> }) => {
        const row = stored({ id: `acc_${rows.length + 1}`, ...data });
        rows.push(row);
        return Promise.resolve(withInstitution(row));
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<Account>;
        }) => {
          const row = rows.find((r) => r.id === where.id)!;
          // Like Prisma: `undefined` leaves the column alone, `null` clears it.
          Object.assign(
            row,
            Object.fromEntries(
              Object.entries(data).filter(([, value]) => value !== undefined),
            ),
          );
          return Promise.resolve(withInstitution(row));
        },
      ),
    },
    financialInstitution: {
      findFirst: jest.fn(
        ({ where }: { where: { id: string; userId: string } }) =>
          Promise.resolve(
            INSTITUTIONS.find(
              (i) => i.id === where.id && i.userId === where.userId,
            ) ?? null,
          ),
      ),
    },
    transaction: {
      count: jest.fn(
        ({
          where,
        }: {
          where: { OR: [{ accountId: string }, { toAccountId: string }] };
        }) => Promise.resolve(movements[where.OR[0].accountId] ?? 0),
      ),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
    },
  };

  const service = new AccountsService(
    prisma as unknown as PrismaService,
    {
      getUserId: jest.fn().mockResolvedValue(USER_ID),
    } as unknown as CurrentUserService,
  );
  return { service, prisma, rows };
}

const create = (dto: Partial<CreateAccountDto>) => ({
  name: 'Cuenta',
  type: AccountType.SAVINGS_ACCOUNT,
  ...dto,
});

describe('AccountsService — crear un producto', () => {
  it('crea una cuenta de ahorros con entidad y tarjeta débito', async () => {
    const { service } = setup();

    const result = await service.create(
      create({
        name: 'Ahorros Bancolombia',
        institutionId: 'bancolombia',
        hasDebitCard: true,
        cardLast4: '1234',
      }),
    );

    expect(result).toMatchObject({
      name: 'Ahorros Bancolombia',
      type: AccountType.SAVINGS_ACCOUNT,
      institution: { id: 'bancolombia', name: 'Bancolombia' },
      hasDebitCard: true,
      cardLast4: '1234',
      currentBalance: 0,
    });
  });

  it('sin entidad ni tarjeta, deja los valores por defecto', async () => {
    const { service } = setup();

    const result = await service.create(
      create({ name: 'Efectivo', type: AccountType.CASH }),
    );

    expect(result).toMatchObject({
      institution: null,
      hasDebitCard: false,
      cardLast4: null,
    });
  });

  it('una tarjeta de crédito guarda sus 4 dígitos sin tarjeta débito', async () => {
    const { service } = setup();

    const result = await service.create(
      create({ type: AccountType.CREDIT_CARD, cardLast4: '9876' }),
    );

    expect(result).toMatchObject({ hasDebitCard: false, cardLast4: '9876' });
  });

  it('rechaza una entidad de otro usuario (400)', async () => {
    const { service, prisma } = setup();

    const call = service.create(create({ institutionId: 'other_bank' }));

    await expect(call).rejects.toBeInstanceOf(BadRequestException);
    await expect(call).rejects.toThrow('Institution other_bank not found');
    expect(prisma.account.create).not.toHaveBeenCalled();
  });

  it.each([AccountType.CREDIT_CARD, AccountType.CASH])(
    'rechaza tarjeta débito en %s (400)',
    async (type) => {
      const { service } = setup();

      await expect(
        service.create(create({ type, hasDebitCard: true })),
      ).rejects.toThrow(DEBIT_CARD_NOT_ALLOWED_MESSAGE);
    },
  );

  it.each([AccountType.CHECKING_ACCOUNT, AccountType.DIGITAL_WALLET])(
    'acepta tarjeta débito en %s',
    async (type) => {
      const { service } = setup();

      await expect(
        service.create(create({ type, hasDebitCard: true })),
      ).resolves.toMatchObject({ type, hasDebitCard: true });
    },
  );

  it('rechaza dígitos de tarjeta en una cuenta sin tarjeta (400)', async () => {
    const { service } = setup();

    await expect(service.create(create({ cardLast4: '1234' }))).rejects.toThrow(
      CARD_LAST4_WITHOUT_CARD_MESSAGE,
    );
  });
});

describe('AccountsService — editar un producto (PATCH /accounts/:id)', () => {
  it('reclasifica Ahorros Bancolombia: DEBIT_CARD → ahorros con tarjeta débito y entidad', async () => {
    const { service, prisma } = setup(
      [
        stored({
          id: 'ahorros',
          name: 'Ahorros Bancolombia',
          type: AccountType.DEBIT_CARD,
          initialBalance: new Prisma.Decimal(5_199_379.32),
        }),
      ],
      { ahorros: 164 },
    );

    const result = await service.update('ahorros', {
      type: AccountType.SAVINGS_ACCOUNT,
      hasDebitCard: true,
      cardLast4: '1234',
      institutionId: 'bancolombia',
    });

    expect(result).toMatchObject({
      name: 'Ahorros Bancolombia',
      type: AccountType.SAVINGS_ACCOUNT,
      hasDebitCard: true,
      cardLast4: '1234',
      institution: { id: 'bancolombia', name: 'Bancolombia' },
      initialBalance: 5_199_379.32,
    });
    // Between non-card types the movements are not even counted.
    expect(prisma.transaction.count).not.toHaveBeenCalled();
  });

  it('solo cambia lo que llega: renombrar una cuenta vieja DEBIT_CARD la deja como está', async () => {
    const { service } = setup([
      stored({ id: 'ahorros', type: AccountType.DEBIT_CARD, cardLast4: null }),
    ]);

    const result = await service.update('ahorros', { name: 'Ahorros' });

    expect(result).toMatchObject({
      name: 'Ahorros',
      type: AccountType.DEBIT_CARD,
      hasDebitCard: false,
      institution: null,
    });
  });

  it('institutionId = null desliga la cuenta de su entidad', async () => {
    const { service } = setup([
      stored({ id: 'nequi', institutionId: 'bancolombia' }),
    ]);

    const result = await service.update('nequi', { institutionId: null });

    expect(result.institution).toBeNull();
  });

  it('rechaza una entidad de otro usuario (400)', async () => {
    const { service, prisma } = setup([stored({ id: 'nequi' })]);

    await expect(
      service.update('nequi', { institutionId: 'other_bank' }),
    ).rejects.toThrow('Institution other_bank not found');
    expect(prisma.account.update).not.toHaveBeenCalled();
  });

  it('una cuenta de otro usuario no existe (404)', async () => {
    const { service } = setup([stored({ id: 'ajena', userId: 'user_2' })]);

    await expect(service.update('ajena', { name: 'X' })).rejects.toThrow(
      'Account ajena not found',
    );
  });

  it.each([
    [AccountType.CREDIT_CARD, AccountType.SAVINGS_ACCOUNT],
    [AccountType.SAVINGS_ACCOUNT, AccountType.CREDIT_CARD],
    [AccountType.DEBIT_CARD, AccountType.CREDIT_CARD],
  ])('con movimientos, rechaza pasar de %s a %s (400)', async (from, to) => {
    const { service, prisma } = setup([stored({ id: 'acc', type: from })], {
      acc: 6,
    });

    const call = service.update('acc', { type: to });

    await expect(call).rejects.toBeInstanceOf(BadRequestException);
    await expect(call).rejects.toThrow(CREDIT_CARD_TYPE_CHANGE_MESSAGE);
    expect(prisma.account.update).not.toHaveBeenCalled();
  });

  it('cuenta los movimientos como origen y como destino de una transferencia', async () => {
    const { service, prisma } = setup([stored({ id: 'acc' })]);

    await service.update('acc', { type: AccountType.CREDIT_CARD });

    expect(prisma.transaction.count).toHaveBeenCalledWith({
      where: { OR: [{ accountId: 'acc' }, { toAccountId: 'acc' }] },
    });
  });

  it('sin movimientos, una cuenta puede pasar a tarjeta de crédito y volver', async () => {
    const { service } = setup([stored({ id: 'acc' })]);

    await expect(
      service.update('acc', { type: AccountType.CREDIT_CARD }),
    ).resolves.toMatchObject({ type: AccountType.CREDIT_CARD });
    await expect(
      service.update('acc', { type: AccountType.DIGITAL_WALLET }),
    ).resolves.toMatchObject({ type: AccountType.DIGITAL_WALLET });
  });

  it('con movimientos, cambiar entre tipos que no son tarjeta sí se puede', async () => {
    const { service } = setup(
      [stored({ id: 'nequi', type: AccountType.SAVINGS_ACCOUNT })],
      { nequi: 12 },
    );

    await expect(
      service.update('nequi', { type: AccountType.DIGITAL_WALLET }),
    ).resolves.toMatchObject({ type: AccountType.DIGITAL_WALLET });
  });

  it('rechaza poner tarjeta débito en una tarjeta de crédito (400)', async () => {
    const { service } = setup([
      stored({ id: 'visa', type: AccountType.CREDIT_CARD }),
    ]);

    await expect(
      service.update('visa', { hasDebitCard: true }),
    ).rejects.toThrow(DEBIT_CARD_NOT_ALLOWED_MESSAGE);
  });

  it('valida el estado final: pasar a CREDIT_CARD exige quitar la tarjeta débito', async () => {
    const { service } = setup([stored({ id: 'acc', hasDebitCard: true })]);

    await expect(
      service.update('acc', { type: AccountType.CREDIT_CARD }),
    ).rejects.toThrow(DEBIT_CARD_NOT_ALLOWED_MESSAGE);
    await expect(
      service.update('acc', {
        type: AccountType.CREDIT_CARD,
        hasDebitCard: false,
      }),
    ).resolves.toMatchObject({ type: AccountType.CREDIT_CARD });
  });

  it('quitar la tarjeta débito exige borrar también sus dígitos', async () => {
    const { service } = setup([
      stored({ id: 'acc', hasDebitCard: true, cardLast4: '1234' }),
    ]);

    await expect(
      service.update('acc', { hasDebitCard: false }),
    ).rejects.toThrow(CARD_LAST4_WITHOUT_CARD_MESSAGE);
    await expect(
      service.update('acc', { hasDebitCard: false, cardLast4: null }),
    ).resolves.toMatchObject({ hasDebitCard: false, cardLast4: null });
  });
});

describe('AccountsService — configurar una tarjeta de crédito', () => {
  const card = (overrides: Partial<Account> = {}) =>
    stored({ id: 'visa', type: AccountType.CREDIT_CARD, ...overrides });

  it('una tarjeta nueva (sin saldo ni movimientos) se configura con PATCH', async () => {
    const { service } = setup([
      card({ initialBalance: new Prisma.Decimal(0) }),
    ]);

    const result = await service.update('visa', {
      creditLimit: 11_500_000,
      statementDay: 29,
      paymentDueDay: 15,
    });

    expect(result.creditCard).toMatchObject({
      configured: true,
      creditLimit: 11_500_000,
      statementDay: 29,
      paymentDueDay: 15,
      debt: 0,
      available: 11_500_000,
    });
  });

  it('también al crearla', async () => {
    const { service } = setup();

    const result = await service.create(
      create({
        type: AccountType.CREDIT_CARD,
        creditLimit: 11_500_000,
        defaultMonthlyRate: 2.1155,
      }),
    );

    expect(result.creditCard).toMatchObject({
      configured: true,
      defaultMonthlyRate: 2.1155,
    });
  });

  it('a una tarjeta con saldo no se le pone cupo a secas: va por statement-balance (400)', async () => {
    // TC VISA today: its anchor is the available credit, not the debt.
    const { service, prisma } = setup([
      card({ initialBalance: new Prisma.Decimal(1_766_523) }),
    ]);

    await expect(
      service.update('visa', { creditLimit: 4_300_000 }),
    ).rejects.toThrow(CONFIGURE_WITH_STATEMENT_MESSAGE);
    expect(prisma.account.update).not.toHaveBeenCalled();
  });

  it('ni a una con movimientos', async () => {
    const { service } = setup([card()], { visa: 6 });

    await expect(
      service.update('visa', { creditLimit: 4_300_000 }),
    ).rejects.toThrow(CONFIGURE_WITH_STATEMENT_MESSAGE);
  });

  it('una tarjeta ya configurada cambia su cupo, días y tasa aunque tenga movimientos', async () => {
    const { service, prisma } = setup(
      [
        card({
          initialBalance: new Prisma.Decimal(-4_539_024),
          creditLimit: new Prisma.Decimal(4_300_000),
        }),
      ],
      { visa: 6 },
    );

    const result = await service.update('visa', {
      creditLimit: 5_000_000,
      statementDay: 31,
      paymentDueDay: 17,
      defaultMonthlyRate: 2.1155,
    });

    expect(result.creditCard).toMatchObject({
      creditLimit: 5_000_000,
      debt: 4_539_024,
      available: 460_976,
      overLimit: 0,
    });
    expect(prisma.transaction.count).not.toHaveBeenCalled();
  });

  it('días y tasa sin cupo no configuran la tarjeta ni piden extracto', async () => {
    const { service } = setup([
      card({ initialBalance: new Prisma.Decimal(1_766_523) }),
    ]);

    const result = await service.update('visa', {
      statementDay: 31,
      paymentDueDay: 17,
    });

    expect(result.creditCard).toMatchObject({
      configured: false,
      statementDay: 31,
      debt: null,
    });
  });

  it('creditLimit = null deja la tarjeta sin configurar', async () => {
    const { service } = setup([
      card({ creditLimit: new Prisma.Decimal(4_300_000) }),
    ]);

    const result = await service.update('visa', { creditLimit: null });

    expect(result.creditCard).toMatchObject({
      configured: false,
      creditLimit: null,
    });
  });

  it.each([AccountType.SAVINGS_ACCOUNT, AccountType.CASH])(
    'rechaza campos de tarjeta en %s (400)',
    async (type) => {
      const { service } = setup([stored({ id: 'acc', type })]);

      await expect(service.update('acc', { statementDay: 31 })).rejects.toThrow(
        CARD_FIELDS_ONLY_ON_CREDIT_CARD_MESSAGE,
      );
      await expect(
        service.create(create({ type, creditLimit: 1_000_000 })),
      ).rejects.toThrow(CARD_FIELDS_ONLY_ON_CREDIT_CARD_MESSAGE);
    },
  );

  it('una tarjeta configurada que deja de serlo exige borrar sus campos', async () => {
    const { service } = setup([
      card({
        creditLimit: new Prisma.Decimal(1_000_000),
        statementDay: 29,
      }),
    ]);

    await expect(
      service.update('visa', { type: AccountType.SAVINGS_ACCOUNT }),
    ).rejects.toThrow(CARD_FIELDS_ONLY_ON_CREDIT_CARD_MESSAGE);
    await expect(
      service.update('visa', {
        type: AccountType.SAVINGS_ACCOUNT,
        creditLimit: null,
        statementDay: null,
      }),
    ).resolves.toMatchObject({
      type: AccountType.SAVINGS_ACCOUNT,
      creditCard: null,
    });
  });
});
