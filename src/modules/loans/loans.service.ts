import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Category, LoanStatus, Prisma, TransactionType } from '@prisma/client';
import { CurrentUserService } from '@common/services/current-user.service';
import { toMonthYear } from '@common/utils/month.util';
import { FinancialPeriodService } from '@modules/financial-periods/financial-period.service';
import { PrismaService } from '@modules/prisma/prisma.service';
import type { CreateLoanDto } from './dto/create-loan.dto';
import type { CreateLoanRepaymentDto } from './dto/create-loan-repayment.dto';
import type { UpdateLoanDto } from './dto/update-loan.dto';
import {
  toLoanDetailResponse,
  toLoanResponse,
  type ILoanDetailResponse,
  type ILoanResponse,
  type LoanWithRepayments,
} from './interfaces/loan-response.interface';

const REPAYMENTS_DESC = {
  repayments: { orderBy: { paidAt: 'desc' as const } },
};

/** Estado de un préstamo según lo abonado frente al monto prestado. */
function loanStatusFor(
  amountRepaid: Prisma.Decimal,
  amount: Prisma.Decimal,
): LoanStatus {
  if (amountRepaid.greaterThanOrEqualTo(amount)) return LoanStatus.PAID;
  if (amountRepaid.greaterThan(0)) return LoanStatus.PARTIALLY_PAID;
  return LoanStatus.ACTIVE;
}

@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly financialPeriods: FinancialPeriodService,
  ) {}

  async findAll(): Promise<ILoanResponse[]> {
    const userId = await this.currentUser.getUserId();

    const loans = await this.prisma.loan.findMany({
      where: { userId },
      orderBy: { loanDate: 'desc' },
    });

    return loans.map(toLoanResponse);
  }

  async findOne(id: string): Promise<ILoanDetailResponse> {
    const userId = await this.currentUser.getUserId();
    return toLoanDetailResponse(await this.findOwned(id, userId));
  }

  async create(dto: CreateLoanDto): Promise<ILoanResponse> {
    const userId = await this.currentUser.getUserId();
    const accountId = dto.accountId ?? null;
    await this.assertAccountOwnership(accountId, userId);

    const amount = new Prisma.Decimal(dto.amount);
    const loanDate = new Date(dto.loanDate);

    const created = await this.prisma.$transaction(async (tx) => {
      const loan = await tx.loan.create({
        data: {
          userId,
          borrowerName: dto.borrowerName,
          amount,
          loanDate,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          note: dto.note ?? null,
          accountId,
        },
      });

      // No pasa por `TransactionsService`: `LOAN_GIVEN` no consume
      // presupuesto ni cuenta como ingreso, así que no hay nada de esa
      // lógica que reutilizar — solo el registro del movimiento en sí.
      const transaction = await tx.transaction.create({
        data: {
          userId,
          accountId,
          loanId: loan.id,
          amount,
          type: TransactionType.LOAN_GIVEN,
          category: Category.LOAN,
          description: `Préstamo a ${dto.borrowerName}`,
          rawMessage: '',
          transactionDate: loanDate,
          monthYear: toMonthYear(loanDate),
        },
      });
      await this.financialPeriods.assignTransactionToPeriod(tx, transaction);

      return loan;
    });

    return toLoanResponse(created);
  }

  async update(id: string, dto: UpdateLoanDto): Promise<ILoanResponse> {
    const userId = await this.currentUser.getUserId();
    const loan = await this.findOwned(id, userId);

    if (dto.accountId !== undefined) {
      await this.assertAccountOwnership(dto.accountId, userId);
    }

    const amount =
      dto.amount !== undefined ? new Prisma.Decimal(dto.amount) : undefined;
    if (amount?.lessThan(loan.amountRepaid)) {
      throw new BadRequestException(
        `Loan amount (${amount.toNumber()}) cannot be lower than the amount already repaid (${loan.amountRepaid.toNumber()})`,
      );
    }
    const loanDate =
      dto.loanDate !== undefined ? new Date(dto.loanDate) : undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.loan.update({
        where: { id },
        data: {
          ...(dto.borrowerName !== undefined
            ? { borrowerName: dto.borrowerName }
            : {}),
          ...(amount !== undefined
            ? { amount, status: loanStatusFor(loan.amountRepaid, amount) }
            : {}),
          ...(loanDate !== undefined ? { loanDate } : {}),
          ...(dto.dueDate !== undefined
            ? { dueDate: new Date(dto.dueDate) }
            : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
          ...(dto.accountId !== undefined ? { accountId: dto.accountId } : {}),
        },
      });

      await this.syncGivenTransaction(tx, id, {
        amount,
        loanDate,
        accountId: dto.accountId,
        borrowerName: dto.borrowerName,
      });

      return next;
    });

    return toLoanResponse(updated);
  }

  async remove(id: string): Promise<void> {
    const userId = await this.currentUser.getUserId();
    const loan = await this.findOwned(id, userId);

    if (loan.amountRepaid.greaterThan(0)) {
      throw new BadRequestException(
        'Cannot delete a loan with repayments already recorded — mark it as paid instead, deleting it here would erase that repayment history.',
      );
    }

    // La FK de `Transaction.loanId` es `onDelete: Cascade`: esto se lleva
    // consigo la `Transaction` LOAN_GIVEN. No hay nada que revertir en
    // `Budget` porque ese tipo nunca lo tocó.
    await this.prisma.loan.delete({ where: { id } });
  }

  async addRepayment(
    id: string,
    dto: CreateLoanRepaymentDto,
  ): Promise<ILoanDetailResponse> {
    const userId = await this.currentUser.getUserId();
    const loan = await this.findOwned(id, userId);

    const amount = new Prisma.Decimal(dto.amount);
    const nextAmountRepaid = loan.amountRepaid.add(amount);
    const nextStatus = loanStatusFor(nextAmountRepaid, loan.amount);
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const repayment = await tx.loanRepayment.create({
        data: { loanId: id, amount, paidAt, note: dto.note ?? null },
      });

      const transaction = await tx.transaction.create({
        data: {
          userId,
          accountId: loan.accountId,
          loanId: id,
          loanRepaymentId: repayment.id,
          amount,
          type: TransactionType.LOAN_REPAYMENT,
          category: Category.LOAN,
          description: `Abono de ${loan.borrowerName}`,
          rawMessage: '',
          transactionDate: paidAt,
          monthYear: toMonthYear(paidAt),
        },
      });
      await this.financialPeriods.assignTransactionToPeriod(tx, transaction);

      return tx.loan.update({
        where: { id },
        data: {
          amountRepaid: { increment: amount },
          status: nextStatus,
        },
        include: REPAYMENTS_DESC,
      });
    });

    return toLoanDetailResponse(updated);
  }

  /**
   * Deshace un abono. Su `LOAN_REPAYMENT` se va con él por la FK
   * `Transaction.loanRepaymentId` (cascade); un abono viejo sin transacción
   * vinculada se borra igual. Como `LOAN_REPAYMENT` no entra en ledger ni en
   * presupuestos, no hay cascada que disparar.
   */
  async removeRepayment(
    id: string,
    repaymentId: string,
  ): Promise<ILoanDetailResponse> {
    const userId = await this.currentUser.getUserId();
    const loan = await this.findOwned(id, userId);

    const repayment = loan.repayments.find((item) => item.id === repaymentId);
    if (!repayment) {
      throw new NotFoundException(
        `Repayment ${repaymentId} not found in loan ${id}`,
      );
    }

    const nextAmountRepaid = loan.amountRepaid.minus(repayment.amount);
    const nextStatus = loanStatusFor(nextAmountRepaid, loan.amount);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.loanRepayment.delete({ where: { id: repaymentId } });

      return tx.loan.update({
        where: { id },
        data: {
          amountRepaid: { decrement: repayment.amount },
          status: nextStatus,
        },
        include: REPAYMENTS_DESC,
      });
    });

    return toLoanDetailResponse(updated);
  }

  /**
   * Lleva a la transacción `LOAN_GIVEN` del préstamo los campos que cambiaron
   * en él. No dispara la cascada de ledger y presupuestos: `LOAN_GIVEN` no
   * entra en ninguno de los dos (ver `EXPENSE_TYPES` en `PeriodLedgerService`
   * y `BUDGET_AFFECTING_TYPES` en `BudgetRecalculationService`), y el saldo de
   * las cuentas se calcula al leerlo.
   */
  private async syncGivenTransaction(
    tx: Prisma.TransactionClient,
    loanId: string,
    changes: {
      amount?: Prisma.Decimal;
      loanDate?: Date;
      accountId?: string | null;
      borrowerName?: string;
    },
  ): Promise<void> {
    const data: Prisma.TransactionUncheckedUpdateInput = {
      ...(changes.amount !== undefined ? { amount: changes.amount } : {}),
      ...(changes.loanDate !== undefined
        ? {
            transactionDate: changes.loanDate,
            monthYear: toMonthYear(changes.loanDate),
          }
        : {}),
      ...(changes.accountId !== undefined
        ? { accountId: changes.accountId }
        : {}),
      ...(changes.borrowerName !== undefined
        ? { description: `Préstamo a ${changes.borrowerName}` }
        : {}),
    };
    if (Object.keys(data).length === 0) return;

    const given = await tx.transaction.findFirst({
      where: { loanId, type: TransactionType.LOAN_GIVEN },
      select: { id: true },
    });
    // Un `LOAN_GIVEN` borrado desde Gastos antes de que /transactions lo
    // bloqueara: no queda movimiento que corregir, solo el préstamo.
    if (!given) return;

    const transaction = await tx.transaction.update({
      where: { id: given.id },
      data,
    });
    if (changes.loanDate !== undefined) {
      await this.financialPeriods.assignTransactionToPeriod(tx, transaction);
    }
  }

  private async findOwned(
    id: string,
    userId: string,
  ): Promise<LoanWithRepayments> {
    const loan = await this.prisma.loan.findFirst({
      where: { id, userId },
      include: REPAYMENTS_DESC,
    });

    if (!loan) {
      throw new NotFoundException(`Loan ${id} not found`);
    }

    return loan;
  }

  private async assertAccountOwnership(
    accountId: string | null,
    userId: string,
  ): Promise<void> {
    if (!accountId) return;

    const account = await this.prisma.account.findFirst({
      where: { id: accountId, userId },
      select: { id: true },
    });

    if (!account) {
      throw new BadRequestException(`Account ${accountId} not found`);
    }
  }
}
