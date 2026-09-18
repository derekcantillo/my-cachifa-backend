import { Injectable } from '@nestjs/common';
import { CurrentUserService } from '@common/services/current-user.service';
import { currentMonthYear } from '@common/utils/month.util';
import { PrismaService } from '@modules/prisma/prisma.service';
import {
  toMonthlyLedgerResponse,
  type IMonthlyLedgerResponse,
} from './interfaces/monthly-ledger-response.interface';
import { CASCADE_TRANSACTION_OPTIONS } from './monthly-ledger.constants';
import { MonthlyLedgerService } from './monthly-ledger.service';

/** Cara REST de `MonthlyLedgerService`, que el resto de servicios usa dentro de sus propias transacciones. */
@Injectable()
export class MonthlyLedgerQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly monthlyLedger: MonthlyLedgerService,
  ) {}

  async findByMonth(month?: string): Promise<IMonthlyLedgerResponse> {
    const userId = await this.currentUser.getUserId();
    const monthYear = month ?? currentMonthYear();

    const ledger = await this.prisma.$transaction(
      (tx) => this.monthlyLedger.getOrBuildLedger(tx, userId, monthYear),
      CASCADE_TRANSACTION_OPTIONS,
    );

    return toMonthlyLedgerResponse(ledger);
  }

  async recalculateFrom(month: string): Promise<IMonthlyLedgerResponse[]> {
    const userId = await this.currentUser.getUserId();

    const ledgers = await this.prisma.$transaction(
      (tx) => this.monthlyLedger.recalculateLedgerCascade(tx, userId, month),
      CASCADE_TRANSACTION_OPTIONS,
    );

    return ledgers.map(toMonthlyLedgerResponse);
  }
}
