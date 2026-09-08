import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Category, LoanStatus, Prisma, TransactionType } from '@prisma/client';
import { CurrentUserService } from '@common/services/current-user.service';
import { toMonthYear } from '@common/utils/month.util';
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

@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
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
      await tx.transaction.create({
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

      return loan;
    });

    return toLoanResponse(created);
  }

  async update(id: string, dto: UpdateLoanDto): Promise<ILoanResponse> {
    const userId = await this.currentUser.getUserId();
    await this.findOwned(id, userId);

    const updated = await this.prisma.loan.update({
      where: { id },
      data: {
        ...(dto.borrowerName !== undefined
          ? { borrowerName: dto.borrowerName }
          : {}),
        ...(dto.dueDate !== undefined
          ? { dueDate: new Date(dto.dueDate) }
          : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
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
    const nextStatus = nextAmountRepaid.greaterThanOrEqualTo(loan.amount)
      ? LoanStatus.PAID
      : LoanStatus.PARTIALLY_PAID;
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.loanRepayment.create({
        data: { loanId: id, amount, paidAt, note: dto.note ?? null },
      });

      await tx.transaction.create({
        data: {
          userId,
          accountId: loan.accountId,
          loanId: id,
          amount,
          type: TransactionType.LOAN_REPAYMENT,
          category: Category.LOAN,
          description: `Abono de ${loan.borrowerName}`,
          rawMessage: '',
          transactionDate: paidAt,
          monthYear: toMonthYear(paidAt),
        },
      });

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
