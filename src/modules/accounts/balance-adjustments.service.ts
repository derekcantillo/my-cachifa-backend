import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountType,
  BalanceAdjustmentReason,
  Prisma,
  type Account,
} from '@prisma/client';
import { CurrentUserService } from '@common/services/current-user.service';
import { toFinancialCalendarDate } from '@common/utils/period.util';
import { PrismaService } from '@modules/prisma/prisma.service';
import { AccountsService } from './accounts.service';
import type { StatementBalanceDto } from './dto/statement-balance.dto';
import type { UpdateInitialBalanceDto } from './dto/update-initial-balance.dto';
import {
  ACCOUNT_INCLUDE,
  toAccountResponse,
  type IAccountResponse,
} from './interfaces/account-response.interface';
import {
  BALANCE_ADJUSTMENT_INCLUDE,
  toBalanceAdjustmentResponse,
  type IBalanceAdjustmentResponse,
  type IBalanceAdjustmentResult,
} from './interfaces/balance-adjustment-response.interface';
import {
  formatCalendarDate,
  parseCalendarDate,
  startOfNextFinancialDay,
  type CalendarDate,
} from './lib/credit-card';

export const CARD_STATEMENT_FIELDS_MESSAGE =
  'A CREDIT_CARD is anchored with cutDate and totalDebt (and optionally creditLimit), not date or balance';

export const ACCOUNT_STATEMENT_FIELDS_MESSAGE =
  'An account that is not a CREDIT_CARD is anchored with date and balance, not cutDate, totalDebt or creditLimit';

export const ADJUSTMENT_ALREADY_REVERTED_MESSAGE =
  'This adjustment was already reverted';

export const ADJUSTMENT_NOT_CURRENT_MESSAGE =
  'The anchor changed after this adjustment: revert the newer adjustments first';

export const ADJUSTMENT_TYPE_CHANGED_MESSAGE =
  'The account is no longer a CREDIT_CARD: its credit limit cannot be restored';

const invalidDateMessage = (field: string) =>
  `${field} is not a valid calendar date`;
const futureDateMessage = (field: string) => `${field} cannot be in the future`;

/** El ancla y el cupo que deja un ajuste. */
interface Anchor {
  amount: Prisma.Decimal;
  date: Date | null;
  creditLimit: Prisma.Decimal | null;
}

const sameInstant = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * Historial del ancla de cada cuenta (`account_balance_adjustments`): anclar a
 * un extracto o al saldo del banco, el `PATCH initial-balance` de siempre y la
 * reversión. Ninguno toca transacciones: mover el ancla solo cambia desde
 * cuándo cuentan para el saldo (ledger y presupuestos no leen el ancla).
 */
@Injectable()
export class BalanceAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly accounts: AccountsService,
  ) {}

  /**
   * Una tarjeta queda en `−totalDebt` y una cuenta en `balance`, a las 00:00
   * de Bogotá del día siguiente: todo lo de ese día, a cualquier hora, ya está
   * dentro del extracto y no se cuenta dos veces.
   */
  async anchorToStatement(
    id: string,
    dto: StatementBalanceDto,
    now: Date = new Date(),
  ): Promise<IBalanceAdjustmentResult> {
    const account = await this.findOwnedAccount(id);
    const isCard = account.type === AccountType.CREDIT_CARD;

    const { field, value, amount } = isCard
      ? this.cardStatement(dto)
      : this.accountStatement(dto);
    const statementDate = this.parsePastDate(field, value, now);

    return this.applyAnchor(account, {
      reason: BalanceAdjustmentReason.STATEMENT,
      anchor: {
        amount,
        date: startOfNextFinancialDay(statementDate),
        creditLimit:
          dto.creditLimit == null
            ? account.creditLimit
            : new Prisma.Decimal(dto.creditLimit),
      },
      statementDate,
    });
  }

  /** `PATCH /accounts/:id/initial-balance`, igual que antes, pero con historial. */
  async updateInitialBalance(
    id: string,
    dto: UpdateInitialBalanceDto,
  ): Promise<IAccountResponse> {
    const account = await this.findOwnedAccount(id);
    const { account: updated } = await this.applyAnchor(account, {
      reason: BalanceAdjustmentReason.INITIAL_BALANCE,
      anchor: {
        amount: new Prisma.Decimal(dto.amount),
        date: new Date(dto.date),
        creditLimit: account.creditLimit,
      },
    });
    return updated;
  }

  async findAll(id: string): Promise<IBalanceAdjustmentResponse[]> {
    await this.findOwnedAccount(id);
    const adjustments = await this.prisma.accountBalanceAdjustment.findMany({
      where: { accountId: id },
      orderBy: { createdAt: 'desc' },
      include: BALANCE_ADJUSTMENT_INCLUDE,
    });
    return adjustments.map(toBalanceAdjustmentResponse);
  }

  /**
   * Vuelve al ancla (y al cupo, si ese ajuste lo cambió) que había antes. Solo
   * si el ancla actual sigue siendo la que dejó ese ajuste: si hubo otro
   * después, se revierte primero el más nuevo. La reversión queda como un
   * ajuste `REVERT`, que a su vez se puede revertir.
   */
  async revert(
    id: string,
    adjustmentId: string,
  ): Promise<IBalanceAdjustmentResult> {
    const account = await this.findOwnedAccount(id);
    const adjustment = await this.prisma.accountBalanceAdjustment.findFirst({
      where: { id: adjustmentId, accountId: id },
      include: BALANCE_ADJUSTMENT_INCLUDE,
    });
    if (!adjustment) {
      throw new NotFoundException(
        `Balance adjustment ${adjustmentId} not found`,
      );
    }
    if (adjustment.revertedBy) {
      throw new ConflictException(ADJUSTMENT_ALREADY_REVERTED_MESSAGE);
    }
    if (
      !account.initialBalance.equals(adjustment.newAmount) ||
      !sameInstant(account.initialBalanceDate, adjustment.newDate)
    ) {
      throw new ConflictException(ADJUSTMENT_NOT_CURRENT_MESSAGE);
    }

    const changedLimit = !decimalsEqual(
      adjustment.oldCreditLimit,
      adjustment.newCreditLimit,
    );
    if (
      changedLimit &&
      adjustment.oldCreditLimit !== null &&
      account.type !== AccountType.CREDIT_CARD
    ) {
      throw new ConflictException(ADJUSTMENT_TYPE_CHANGED_MESSAGE);
    }

    return this.applyAnchor(account, {
      reason: BalanceAdjustmentReason.REVERT,
      anchor: {
        amount: adjustment.oldAmount,
        date: adjustment.oldDate,
        creditLimit: changedLimit
          ? adjustment.oldCreditLimit
          : account.creditLimit,
      },
      revertsId: adjustment.id,
    });
  }

  private cardStatement(dto: StatementBalanceDto): {
    field: string;
    value: string;
    amount: Prisma.Decimal;
  } {
    if (
      dto.cutDate == null ||
      dto.totalDebt == null ||
      dto.date != null ||
      dto.balance != null
    ) {
      throw new BadRequestException(CARD_STATEMENT_FIELDS_MESSAGE);
    }
    // Card convention: what is owed is a negative balance.
    return {
      field: 'cutDate',
      value: dto.cutDate,
      amount: new Prisma.Decimal(dto.totalDebt).negated(),
    };
  }

  private accountStatement(dto: StatementBalanceDto): {
    field: string;
    value: string;
    amount: Prisma.Decimal;
  } {
    if (
      dto.date == null ||
      dto.balance == null ||
      dto.cutDate != null ||
      dto.totalDebt != null ||
      dto.creditLimit != null
    ) {
      throw new BadRequestException(ACCOUNT_STATEMENT_FIELDS_MESSAGE);
    }
    return {
      field: 'date',
      value: dto.date,
      amount: new Prisma.Decimal(dto.balance),
    };
  }

  /** Un día que existe y que no es posterior a hoy en Bogotá. */
  private parsePastDate(field: string, value: string, now: Date): CalendarDate {
    const date = parseCalendarDate(value);
    if (!date) {
      throw new BadRequestException(invalidDateMessage(field));
    }
    if (
      formatCalendarDate(date) >
      formatCalendarDate(toFinancialCalendarDate(now))
    ) {
      throw new BadRequestException(futureDateMessage(field));
    }
    return date;
  }

  /** Guarda el ancla nueva y su registro en una sola transacción. */
  private async applyAnchor(
    account: Account,
    change: {
      reason: BalanceAdjustmentReason;
      anchor: Anchor;
      statementDate?: CalendarDate;
      revertsId?: string;
    },
  ): Promise<IBalanceAdjustmentResult> {
    const { anchor } = change;
    const balanceBefore = await this.accounts.computeCurrentBalance(account);
    // Same formula, with the new anchor: it only depends on the transactions.
    const balanceAfter = await this.accounts.computeCurrentBalance({
      ...account,
      initialBalance: anchor.amount,
      initialBalanceDate: anchor.date,
    });

    const [updated, adjustment] = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.account.update({
        where: { id: account.id },
        data: {
          initialBalance: anchor.amount,
          initialBalanceDate: anchor.date,
          creditLimit: anchor.creditLimit,
        },
        include: ACCOUNT_INCLUDE,
      });
      const record = await tx.accountBalanceAdjustment.create({
        data: {
          accountId: account.id,
          reason: change.reason,
          oldAmount: account.initialBalance,
          oldDate: account.initialBalanceDate,
          newAmount: anchor.amount,
          newDate: anchor.date,
          oldCreditLimit: account.creditLimit,
          newCreditLimit: anchor.creditLimit,
          statementDate: change.statementDate
            ? new Date(
                Date.UTC(
                  change.statementDate.year,
                  change.statementDate.month - 1,
                  change.statementDate.day,
                ),
              )
            : null,
          balanceBefore,
          balanceAfter,
          revertsId: change.revertsId ?? null,
        },
        include: BALANCE_ADJUSTMENT_INCLUDE,
      });
      return [saved, record] as const;
    });

    return {
      account: toAccountResponse(updated, balanceAfter),
      adjustment: toBalanceAdjustmentResponse(adjustment),
    };
  }

  private async findOwnedAccount(id: string): Promise<Account> {
    const userId = await this.currentUser.getUserId();
    const account = await this.prisma.account.findFirst({
      where: { id, userId },
    });
    if (!account) {
      throw new NotFoundException(`Account ${id} not found`);
    }
    return account;
  }
}

function decimalsEqual(
  a: Prisma.Decimal | null,
  b: Prisma.Decimal | null,
): boolean {
  return a === null || b === null ? a === b : a.equals(b);
}
