import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrentUserService } from '@common/services/current-user.service';
import { FinancialPeriodService } from '@modules/financial-periods/financial-period.service';
import { CASCADE_TRANSACTION_OPTIONS } from '@modules/period-ledger/period-ledger.constants';
import { PrismaService } from '@modules/prisma/prisma.service';
import { BudgetRecalculationService } from './budget-recalculation.service';
import type { UpsertBudgetsDto } from './dto/upsert-budgets.dto';
import {
  toBudgetResponse,
  type IBudgetResponse,
} from './interfaces/budget-response.interface';

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly financialPeriods: FinancialPeriodService,
    private readonly budgetRecalculation: BudgetRecalculationService,
  ) {}

  async findAll(periodId?: string): Promise<IBudgetResponse[]> {
    const userId = await this.currentUser.getUserId();
    const period = await this.financialPeriods.resolvePeriod(
      this.prisma,
      userId,
      periodId,
    );
    return this.listPeriod(userId, period.id);
  }

  /**
   * Upsert manual de los límites del período. Nunca toca `spentAmount`. Un
   * recálculo posterior sobreescribe los de categorías con gasto fijo o
   * `BudgetRule`; los demás se conservan.
   */
  async upsertMany(
    dto: UpsertBudgetsDto,
    periodId?: string,
  ): Promise<IBudgetResponse[]> {
    const userId = await this.currentUser.getUserId();
    const period = await this.financialPeriods.resolvePeriod(
      this.prisma,
      userId,
      periodId,
    );

    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.budget.upsert({
          where: {
            userId_periodId_category: {
              userId,
              periodId: period.id,
              category: item.category,
            },
          },
          create: {
            userId,
            periodId: period.id,
            category: item.category,
            limitAmount: new Prisma.Decimal(item.limitAmount),
          },
          update: { limitAmount: new Prisma.Decimal(item.limitAmount) },
        }),
      ),
    );

    return this.listPeriod(userId, period.id);
  }

  /**
   * Reaplica gastos fijos y `BudgetRule` al período, bajo demanda —
   * refrescando antes su `PeriodLedger` (y en cascada los siguientes) para
   * que la base incluya el rollover al día.
   */
  async recalculate(periodId: string): Promise<IBudgetResponse[]> {
    const userId = await this.currentUser.getUserId();

    await this.prisma.$transaction(async (tx) => {
      const period = await this.financialPeriods.findOwnedPeriod(
        tx,
        userId,
        periodId,
      );
      await this.budgetRecalculation.recalculateFrom(
        tx,
        userId,
        period.startDate,
      );
    }, CASCADE_TRANSACTION_OPTIONS);

    return this.listPeriod(userId, periodId);
  }

  /**
   * Reinicia `spentAmount` del período a lo que dicen sus transacciones. Con
   * períodos, el gasto de un período nuevo ya arranca en 0; ponerlo en 0 a
   * mano solo duraría hasta la siguiente transacción, así que "reset" es
   * resincronizar con la fuente de verdad.
   */
  async resetSpent(periodId: string): Promise<IBudgetResponse[]> {
    const userId = await this.currentUser.getUserId();

    await this.prisma.$transaction(async (tx) => {
      await this.financialPeriods.findOwnedPeriod(tx, userId, periodId);
      await this.budgetRecalculation.syncSpent(tx, userId, periodId);
    });

    return this.listPeriod(userId, periodId);
  }

  private async listPeriod(
    userId: string,
    periodId: string,
  ): Promise<IBudgetResponse[]> {
    const budgets = await this.prisma.budget.findMany({
      where: { userId, periodId },
      orderBy: { category: 'asc' },
    });

    return budgets.map(toBudgetResponse);
  }
}
