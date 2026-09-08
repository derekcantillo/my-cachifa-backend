import type { Loan, LoanRepayment, LoanStatus } from '@prisma/client';

export type LoanWithRepayments = Loan & { repayments: LoanRepayment[] };

export interface ILoanRepaymentResponse {
  id: string;
  amount: number;
  paidAt: string;
  note: string | null;
  createdAt: string;
}

export interface ILoanResponse {
  id: string;
  borrowerName: string;
  amount: number;
  amountRepaid: number;
  /** `amount - amountRepaid`, para no repetir la resta en cada consumidor. */
  remainingAmount: number;
  status: LoanStatus;
  loanDate: string;
  dueDate: string | null;
  note: string | null;
  accountId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ILoanDetailResponse extends ILoanResponse {
  repayments: ILoanRepaymentResponse[];
}

export function toLoanResponse(loan: Loan): ILoanResponse {
  return {
    id: loan.id,
    borrowerName: loan.borrowerName,
    amount: loan.amount.toNumber(),
    amountRepaid: loan.amountRepaid.toNumber(),
    remainingAmount: loan.amount.minus(loan.amountRepaid).toNumber(),
    status: loan.status,
    loanDate: loan.loanDate.toISOString(),
    dueDate: loan.dueDate ? loan.dueDate.toISOString() : null,
    note: loan.note,
    accountId: loan.accountId,
    createdAt: loan.createdAt.toISOString(),
    updatedAt: loan.updatedAt.toISOString(),
  };
}

export function toLoanRepaymentResponse(
  repayment: LoanRepayment,
): ILoanRepaymentResponse {
  return {
    id: repayment.id,
    amount: repayment.amount.toNumber(),
    paidAt: repayment.paidAt.toISOString(),
    note: repayment.note,
    createdAt: repayment.createdAt.toISOString(),
  };
}

export function toLoanDetailResponse(
  loan: LoanWithRepayments,
): ILoanDetailResponse {
  return {
    ...toLoanResponse(loan),
    repayments: loan.repayments.map(toLoanRepaymentResponse),
  };
}
