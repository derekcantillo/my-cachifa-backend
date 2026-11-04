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
  CARD_LAST4_WITHOUT_CARD_MESSAGE,
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
          Object.assign(row, data);
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
