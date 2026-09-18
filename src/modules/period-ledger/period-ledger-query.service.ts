import { Injectable } from '@nestjs/common';
import { CurrentUserService } from '@common/services/current-user.service';
import { FinancialPeriodService } from '@modules/financial-periods/financial-period.service';
import { PrismaService } from '@modules/prisma/prisma.service';
import {
  toPeriodLedgerResponse,
  type IPeriodLedgerResponse,
} from './interfaces/period-ledger-response.interface';
import { CASCADE_TRANSACTION_OPTIONS } from './period-ledger.constants';
import { PeriodLedgerService } from './period-ledger.service';

/** Cara REST de `PeriodLedgerService`, que el resto de servicios usa dentro de sus propias transacciones. */
@Injectable()
export class PeriodLedgerQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly financialPeriods: FinancialPeriodService,
    private readonly periodLedger: PeriodLedgerService,
  ) {}

  async findByPeriod(periodId?: string): Promise<IPeriodLedgerResponse> {
    const userId = await this.currentUser.getUserId();

    return this.prisma.$transaction(async (tx) => {
      const period = await this.financialPeriods.resolvePeriod(
        tx,
        userId,
        periodId,
      );
      const ledger = await this.periodLedger.getOrBuildLedger(
        tx,
        userId,
        period,
      );
      return toPeriodLedgerResponse(ledger, period);
    }, CASCADE_TRANSACTION_OPTIONS);
  }

  /** Recalcula en cascada desde `periodId` hasta el período actual. */
  async recalculateFrom(periodId: string): Promise<IPeriodLedgerResponse[]> {
    const userId = await this.currentUser.getUserId();

    const ledgers = await this.prisma.$transaction(async (tx) => {
      const period = await this.financialPeriods.findOwnedPeriod(
        tx,
        userId,
        periodId,
      );
      return this.periodLedger.recalculateLedgerCascade(
        tx,
        userId,
        period.startDate,
      );
    }, CASCADE_TRANSACTION_OPTIONS);

    return ledgers.map((ledger) =>
      toPeriodLedgerResponse(ledger, ledger.period),
    );
  }
}
