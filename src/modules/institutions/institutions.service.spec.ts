import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { FinancialInstitution } from '@prisma/client';
import type { CurrentUserService } from '@common/services/current-user.service';
import type { PrismaService } from '@modules/prisma/prisma.service';
import {
  institutionExistsMessage,
  institutionInUseMessage,
  InstitutionsService,
} from './institutions.service';

const USER_ID = 'user_1';
const DATE = new Date('2026-11-04T17:00:00Z');

function institution(
  id: string,
  name: string,
  userId = USER_ID,
): FinancialInstitution {
  return { id, userId, name, createdAt: DATE, updatedAt: DATE };
}

interface FindFirstWhere {
  id?: string | { not: string };
  userId: string;
  name?: { equals: string; mode: 'insensitive' };
}

/** In-memory store that understands the filters the service uses. */
function setup(
  stored: FinancialInstitution[],
  accountsByInstitution: Record<string, number> = {},
) {
  const rows = [...stored];
  const count = (id: string) => accountsByInstitution[id] ?? 0;
  const withCount = (row: FinancialInstitution) => ({
    ...row,
    _count: { accounts: count(row.id) },
  });

  const prisma = {
    financialInstitution: {
      findMany: jest.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve(
          rows
            .filter((row) => row.userId === where.userId)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(withCount),
        ),
      ),
      findFirst: jest.fn(({ where }: { where: FindFirstWhere }) =>
        Promise.resolve(
          rows.find((row) => {
            if (row.userId !== where.userId) return false;
            if (typeof where.id === 'string' && row.id !== where.id) {
              return false;
            }
            if (typeof where.id === 'object' && row.id === where.id.not) {
              return false;
            }
            return (
              !where.name ||
              row.name.toLowerCase() === where.name.equals.toLowerCase()
            );
          }) ?? null,
        ),
      ),
      create: jest.fn(
        ({ data }: { data: { userId: string; name: string } }) => {
          const row = institution(`inst_${rows.length + 1}`, data.name);
          rows.push(row);
          return Promise.resolve(row);
        },
      ),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: { name: string };
        }) => {
          const row = rows.find((r) => r.id === where.id)!;
          row.name = data.name;
          return Promise.resolve(withCount(row));
        },
      ),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        rows.splice(
          rows.findIndex((row) => row.id === where.id),
          1,
        );
        return Promise.resolve(undefined);
      }),
    },
    account: {
      count: jest.fn(({ where }: { where: { institutionId: string } }) =>
        Promise.resolve(count(where.institutionId)),
      ),
    },
  };
  const currentUser = { getUserId: jest.fn().mockResolvedValue(USER_ID) };

  return {
    service: new InstitutionsService(
      prisma as unknown as PrismaService,
      currentUser as unknown as CurrentUserService,
    ),
    prisma,
    rows,
  };
}

describe('InstitutionsService', () => {
  it('lists the user institutions by name with their product count', async () => {
    const { service } = setup(
      [
        institution('nequi', 'Nequi'),
        institution('bancolombia', 'Bancolombia'),
        institution('other_user', 'Davivienda', 'user_2'),
      ],
      { bancolombia: 2 },
    );

    const result = await service.findAll();

    expect(result).toEqual([
      {
        id: 'bancolombia',
        name: 'Bancolombia',
        accountCount: 2,
        createdAt: DATE.toISOString(),
        updatedAt: DATE.toISOString(),
      },
      expect.objectContaining({ id: 'nequi', accountCount: 0 }),
    ]);
  });

  it('creates an institution', async () => {
    const { service } = setup([]);

    const result = await service.create({ name: 'Davivienda' });

    expect(result).toMatchObject({ name: 'Davivienda', accountCount: 0 });
  });

  it('rejects a name that already exists, ignoring case (409)', async () => {
    const { service, prisma } = setup([
      institution('bancolombia', 'Bancolombia'),
    ]);

    const create = service.create({ name: 'BANCOLOMBIA' });

    await expect(create).rejects.toBeInstanceOf(ConflictException);
    await expect(create).rejects.toThrow(
      institutionExistsMessage('Bancolombia'),
    );
    expect(prisma.financialInstitution.create).not.toHaveBeenCalled();
  });

  it('does not see the names of another user', async () => {
    const { service } = setup([institution('other', 'Bancolombia', 'user_2')]);

    await expect(
      service.create({ name: 'Bancolombia' }),
    ).resolves.toMatchObject({ name: 'Bancolombia' });
  });

  it('renames an institution, also when only the case changes', async () => {
    const { service } = setup([institution('bancolombia', 'bancolombia')], {
      bancolombia: 1,
    });

    const result = await service.update('bancolombia', {
      name: 'Bancolombia',
    });

    expect(result).toMatchObject({ name: 'Bancolombia', accountCount: 1 });
  });

  it('rejects renaming to the name of another institution (409)', async () => {
    const { service, prisma } = setup([
      institution('bancolombia', 'Bancolombia'),
      institution('nequi', 'Nequi'),
    ]);

    await expect(
      service.update('nequi', { name: 'bancolombia' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.financialInstitution.update).not.toHaveBeenCalled();
  });

  it.each(['update', 'remove'] as const)(
    '%s: an institution of another user is not found (404)',
    async (method) => {
      const { service } = setup([
        institution('other', 'Bancolombia', 'user_2'),
      ]);

      const call =
        method === 'update'
          ? service.update('other', { name: 'X' })
          : service.remove('other');

      await expect(call).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it('deletes an institution without products', async () => {
    const { service, rows } = setup([institution('nequi', 'Nequi')]);

    await service.remove('nequi');

    expect(rows).toEqual([]);
  });

  it('does not delete an institution with products (400)', async () => {
    const { service, prisma } = setup(
      [institution('bancolombia', 'Bancolombia')],
      { bancolombia: 2 },
    );

    const remove = service.remove('bancolombia');

    await expect(remove).rejects.toBeInstanceOf(BadRequestException);
    await expect(remove).rejects.toThrow(institutionInUseMessage(2));
    expect(prisma.financialInstitution.delete).not.toHaveBeenCalled();
  });
});
