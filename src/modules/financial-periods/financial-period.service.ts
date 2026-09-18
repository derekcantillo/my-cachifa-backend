import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  Category,
  TransactionType,
  type FinancialPeriod,
  type Prisma,
} from '@prisma/client';
import {
  formatPeriodLabel,
  startOfFinancialDay,
} from '@common/utils/period.util';
import { PrismaService } from '@modules/prisma/prisma.service';
import type { IMigratePeriodsResponse } from './interfaces/migrate-periods-response.interface';

type Client = Prisma.TransactionClient;

interface IPeriodSpec {
  startDate: Date;
  endDate: Date | null;
  anchorTxId: string | null;
  label: string;
}

interface IPeriodTransaction {
  id: string;
  userId: string;
  transactionDate: Date;
  type: TransactionType;
  category: Category;
  periodId: string | null;
}

/** Clave de emparejamiento entre períodos guardados y deseados. */
const BOOTSTRAP_KEY = '__bootstrap__';

/**
 * Timeout del `$transaction` de la migración: reconstruye todos los períodos
 * de un usuario y reasigna todo su historial.
 */
const MIGRATION_TRANSACTION_OPTIONS = { timeout: 60_000 } as const;

export function isSalary(tx: {
  type: TransactionType;
  category: Category;
}): boolean {
  return tx.type === TransactionType.INCOME && tx.category === Category.SALARY;
}

/**
 * Mantiene la secuencia de `FinancialPeriod` de un usuario: cada salario abre
 * un período en su día (hora de Colombia) y cierra el anterior. Lo que se
 * registró antes del primer salario vive en un período "de arranque" sin
 * `anchorTxId`, que empieza el día de la transacción más antigua.
 *
 * Todos los métodos reciben el cliente de Prisma para correr dentro del
 * `$transaction` de la mutación que los dispara.
 */
@Injectable()
export class FinancialPeriodService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Período en cuyo rango `[startDate, endDate)` cae `date`. Si la fecha es la
   * de un salario (`opensPeriod`), o si ningún período la cubre todavía, se
   * reconstruye la secuencia primero: el salario abre su período y cierra el
   * anterior el día antes.
   */
  async findOrCreatePeriodForDate(
    client: Client,
    userId: string,
    date: Date,
    options: { opensPeriod?: boolean } = {},
  ): Promise<FinancialPeriod> {
    if (!options.opensPeriod) {
      const existing = await this.findPeriodForDate(client, userId, date);
      if (existing) return existing;
    }

    await this.rebuild(client, userId, date, date);

    const period = await this.findPeriodForDate(client, userId, date);
    if (!period) {
      throw new InternalServerErrorException(
        `No financial period covers ${date.toISOString()} after rebuilding`,
      );
    }
    return period;
  }

  /** Fija `periodId` de `tx` según su `transactionDate`. */
  async assignTransactionToPeriod(
    client: Client,
    tx: IPeriodTransaction,
  ): Promise<FinancialPeriod> {
    const period = await this.findOrCreatePeriodForDate(
      client,
      tx.userId,
      tx.transactionDate,
      { opensPeriod: isSalary(tx) },
    );

    if (tx.periodId !== period.id) {
      await client.transaction.update({
        where: { id: tx.id },
        data: { periodId: period.id },
      });
    }

    return period;
  }

  /**
   * Reconstruye la secuencia de períodos a partir de los salarios actuales
   * (tras crear, mover o borrar uno) y reasigna `periodId` de toda
   * transacción desde el período que contiene `from`. Los períodos que no
   * cambian no se reescriben y conservan su `id`.
   */
  async recalculatePeriodsFrom(
    client: Client,
    userId: string,
    from: Date,
  ): Promise<void> {
    await this.rebuild(client, userId, from);
  }

  /**
   * Migración única desde el modelo de mes calendario: construye los
   * períodos de cada usuario a partir de sus salarios y asigna `periodId` a
   * todo su historial. Es idempotente — correrla de nuevo no cambia nada.
   */
  async migrateAll(): Promise<IMigratePeriodsResponse> {
    const users = await this.prisma.user.findMany({ select: { id: true } });
    const results: IMigratePeriodsResponse['users'] = [];

    for (const { id: userId } of users) {
      const result = await this.prisma.$transaction(async (tx) => {
        await this.rebuild(tx, userId, new Date(0));

        const [periods, transactions, unassigned] = await Promise.all([
          tx.financialPeriod.findMany({
            where: { userId },
            orderBy: { startDate: 'asc' },
            include: { _count: { select: { transactions: true } } },
          }),
          tx.transaction.count({ where: { userId } }),
          tx.transaction.count({ where: { userId, periodId: null } }),
        ]);

        return {
          userId,
          transactions,
          unassigned,
          periods: periods.map((period) => ({
            id: period.id,
            label: period.label,
            startDate: period.startDate.toISOString(),
            endDate: period.endDate?.toISOString() ?? null,
            anchorTxId: period.anchorTxId,
            transactionCount: period._count.transactions,
          })),
        };
      }, MIGRATION_TRANSACTION_OPTIONS);

      results.push(result);
    }

    return { users: results };
  }

  private findPeriodForDate(
    client: Client,
    userId: string,
    date: Date,
  ): Promise<FinancialPeriod | null> {
    return client.financialPeriod.findFirst({
      where: {
        userId,
        startDate: { lte: date },
        OR: [{ endDate: null }, { endDate: { gt: date } }],
      },
      orderBy: { startDate: 'desc' },
    });
  }

  /**
   * `coverDate` extiende el período de arranque hacia atrás para cubrir una
   * fecha que todavía no tiene transacción guardada.
   */
  private async rebuild(
    client: Client,
    userId: string,
    from: Date,
    coverDate?: Date,
  ): Promise<void> {
    const [salaries, oldest, existing] = await Promise.all([
      client.transaction.findMany({
        where: {
          userId,
          type: TransactionType.INCOME,
          category: Category.SALARY,
        },
        select: { id: true, transactionDate: true },
        orderBy: [{ transactionDate: 'asc' }, { id: 'asc' }],
      }),
      client.transaction.findFirst({
        where: { userId },
        select: { transactionDate: true },
        orderBy: { transactionDate: 'asc' },
      }),
      client.financialPeriod.findMany({
        where: { userId },
        orderBy: { startDate: 'asc' },
      }),
    ]);

    const earliest = [oldest?.transactionDate, coverDate]
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const desired = buildPeriodSpecs(salaries, earliest ?? null);

    // Emparejar por salario ancla mantiene el `id` del período aunque el
    // salario cambie de fecha; el de arranque se empareja consigo mismo.
    const existingByKey = new Map<string, FinancialPeriod>();
    const toDelete: FinancialPeriod[] = [];
    for (const period of existing) {
      const key = period.anchorTxId ?? BOOTSTRAP_KEY;
      if (existingByKey.has(key)) toDelete.push(period);
      else existingByKey.set(key, period);
    }
    const desiredKeys = new Set(
      desired.map((spec) => spec.anchorTxId ?? BOOTSTRAP_KEY),
    );
    for (const [key, period] of existingByKey) {
      if (!desiredKeys.has(key)) toDelete.push(period);
    }

    const toUpdate: Array<{ period: FinancialPeriod; spec: IPeriodSpec }> = [];
    const toCreate: IPeriodSpec[] = [];
    for (const spec of desired) {
      const period = existingByKey.get(spec.anchorTxId ?? BOOTSTRAP_KEY);
      if (!period) toCreate.push(spec);
      else if (!sameSpec(period, spec)) toUpdate.push({ period, spec });
    }

    // Toda fecha cuyo período cambió (antes o después) delimita desde dónde
    // hay que reasignar transacciones.
    const touchedDates = [
      startOfFinancialDay(from),
      ...toDelete.map((period) => period.startDate),
      ...toUpdate.flatMap(({ period, spec }) => [
        period.startDate,
        spec.startDate,
      ]),
      ...toCreate.map((spec) => spec.startDate),
    ];
    const boundary = new Date(
      Math.min(...touchedDates.map((date) => date.getTime())),
    );

    if (toDelete.length > 0) {
      await client.financialPeriod.deleteMany({
        where: { id: { in: toDelete.map((period) => period.id) } },
      });
    }

    // Mover un `startDate` puede chocar transitoriamente con el de otro
    // período que también se está moviendo (`@@unique([userId, startDate])`):
    // se estaciona primero en un instante imposible y luego se fija.
    const moving = toUpdate.filter(
      ({ period, spec }) =>
        period.startDate.getTime() !== spec.startDate.getTime(),
    );
    for (const [index, { period }] of moving.entries()) {
      await client.financialPeriod.update({
        where: { id: period.id },
        data: { startDate: new Date(-(index + 1)) },
      });
    }
    for (const { period, spec } of toUpdate) {
      await client.financialPeriod.update({
        where: { id: period.id },
        data: spec,
      });
    }
    for (const spec of toCreate) {
      await client.financialPeriod.create({ data: { userId, ...spec } });
    }

    const periods = await client.financialPeriod.findMany({
      where: {
        userId,
        OR: [{ endDate: null }, { endDate: { gt: boundary } }],
      },
      select: { id: true, startDate: true, endDate: true },
    });

    for (const period of periods) {
      await client.transaction.updateMany({
        where: {
          userId,
          transactionDate: {
            gte: period.startDate,
            ...(period.endDate ? { lt: period.endDate } : {}),
          },
          OR: [{ periodId: null }, { periodId: { not: period.id } }],
        },
        data: { periodId: period.id },
      });
    }
  }
}

/**
 * Secuencia deseada de períodos: uno por día con salario (si hay dos el
 * mismo día, ancla el primero), más el de arranque si hay movimientos antes
 * del primer salario. Cada período termina donde empieza el siguiente.
 */
function buildPeriodSpecs(
  salaries: ReadonlyArray<{ id: string; transactionDate: Date }>,
  earliest: Date | null,
): IPeriodSpec[] {
  const starts: Array<{ startDate: Date; anchorTxId: string | null }> = [];

  for (const salary of salaries) {
    const startDate = startOfFinancialDay(salary.transactionDate);
    const last = starts[starts.length - 1];
    if (last && last.startDate.getTime() === startDate.getTime()) continue;
    starts.push({ startDate, anchorTxId: salary.id });
  }

  if (earliest) {
    const bootstrapStart = startOfFinancialDay(earliest);
    const first = starts[0];
    if (!first || bootstrapStart.getTime() < first.startDate.getTime()) {
      starts.unshift({ startDate: bootstrapStart, anchorTxId: null });
    }
  }

  return starts.map(({ startDate, anchorTxId }, index) => {
    const endDate = starts[index + 1]?.startDate ?? null;
    return {
      startDate,
      endDate,
      anchorTxId,
      label: formatPeriodLabel(startDate, endDate),
    };
  });
}

function sameSpec(period: FinancialPeriod, spec: IPeriodSpec): boolean {
  return (
    period.startDate.getTime() === spec.startDate.getTime() &&
    (period.endDate?.getTime() ?? null) === (spec.endDate?.getTime() ?? null) &&
    period.label === spec.label &&
    period.anchorTxId === spec.anchorTxId
  );
}
