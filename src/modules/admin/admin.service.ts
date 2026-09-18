import { Injectable } from '@nestjs/common';
import { BudgetRecalculationService } from '@modules/budgets/budget-recalculation.service';
import { FinancialPeriodService } from '@modules/financial-periods/financial-period.service';
import { PrismaService } from '@modules/prisma/prisma.service';
import type { IMigratePeriodsResponse } from './interfaces/migrate-periods-response.interface';

/** Desde el inicio de los tiempos: reconstruye todo el historial. */
const EPOCH = new Date(0);

/**
 * Timeout del `$transaction` de la migración: reconstruye todos los períodos
 * de un usuario, reasigna todo su historial y recalcula ledger y
 * presupuestos de cada período.
 */
const MIGRATION_TRANSACTION_OPTIONS = { timeout: 120_000 } as const;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialPeriods: FinancialPeriodService,
    private readonly budgetRecalculation: BudgetRecalculationService,
  ) {}

  /**
   * Reconstrucción completa y idempotente del modelo de períodos: por cada
   * usuario, rehace los períodos desde sus salarios, asigna `periodId` a
   * todo su historial y recalcula `PeriodLedger` y `Budget` de cada período.
   */
  async migratePeriods(): Promise<IMigratePeriodsResponse> {
    const users = await this.prisma.user.findMany({ select: { id: true } });
    const results: IMigratePeriodsResponse['users'] = [];

    for (const { id: userId } of users) {
      const result = await this.prisma.$transaction(async (tx) => {
        await this.financialPeriods.recalculatePeriodsFrom(tx, userId, EPOCH);
        await this.budgetRecalculation.recalculateFrom(tx, userId, EPOCH);

        const [periods, transactions, unassigned] = await Promise.all([
          tx.financialPeriod.findMany({
            where: { userId },
            orderBy: { startDate: 'asc' },
            include: {
              ledgers: true,
              _count: { select: { transactions: true, budgets: true } },
            },
          }),
          tx.transaction.count({ where: { userId } }),
          tx.transaction.count({ where: { userId, periodId: null } }),
        ]);

        return {
          userId,
          transactions,
          unassigned,
          periods: periods.map((period) => {
            const ledger = period.ledgers[0];
            return {
              id: period.id,
              label: period.label,
              startDate: period.startDate.toISOString(),
              endDate: period.endDate?.toISOString() ?? null,
              anchorTxId: period.anchorTxId,
              transactionCount: period._count.transactions,
              openingBalance: ledger?.openingBalance.toNumber() ?? null,
              income: ledger?.income.toNumber() ?? null,
              expenses: ledger?.expenses.toNumber() ?? null,
              closingBalance: ledger?.closingBalance.toNumber() ?? null,
              budgetCount: period._count.budgets,
            };
          }),
        };
      }, MIGRATION_TRANSACTION_OPTIONS);

      results.push(result);
    }

    return { users: results };
  }
}
