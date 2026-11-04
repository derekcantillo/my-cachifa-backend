import type {
  AccountBalanceAdjustment,
  BalanceAdjustmentReason,
} from '@prisma/client';
import type { IAccountResponse } from './account-response.interface';

export type BalanceAdjustmentWithRevert = AccountBalanceAdjustment & {
  revertedBy: { id: string } | null;
};

export const BALANCE_ADJUSTMENT_INCLUDE = {
  revertedBy: { select: { id: true } },
} as const;

/** Un cambio del ancla (`initialBalance` + `initialBalanceDate`) de una cuenta. */
export interface IBalanceAdjustmentResponse {
  id: string;
  accountId: string;
  reason: BalanceAdjustmentReason;
  oldAmount: number;
  oldDate: string | null;
  newAmount: number;
  newDate: string | null;
  oldCreditLimit: number | null;
  newCreditLimit: number | null;
  /** `YYYY-MM-DD` del extracto o del saldo del banco; solo en `STATEMENT`. */
  statementDate: string | null;
  /** `currentBalance` justo antes y justo después del ajuste. */
  balanceBefore: number;
  balanceAfter: number;
  /** En un `REVERT`, el ajuste que deshizo. */
  revertsId: string | null;
  /** El `REVERT` que deshizo este ajuste, si existe. */
  revertedById: string | null;
  createdAt: string;
}

/** Respuesta de `statement-balance` y de `revert`: la cuenta ya ajustada y el registro. */
export interface IBalanceAdjustmentResult {
  account: IAccountResponse;
  adjustment: IBalanceAdjustmentResponse;
}

export function toBalanceAdjustmentResponse(
  adjustment: BalanceAdjustmentWithRevert,
): IBalanceAdjustmentResponse {
  return {
    id: adjustment.id,
    accountId: adjustment.accountId,
    reason: adjustment.reason,
    oldAmount: adjustment.oldAmount.toNumber(),
    oldDate: adjustment.oldDate?.toISOString() ?? null,
    newAmount: adjustment.newAmount.toNumber(),
    newDate: adjustment.newDate?.toISOString() ?? null,
    oldCreditLimit: adjustment.oldCreditLimit?.toNumber() ?? null,
    newCreditLimit: adjustment.newCreditLimit?.toNumber() ?? null,
    statementDate: adjustment.statementDate
      ? adjustment.statementDate.toISOString().slice(0, 10)
      : null,
    balanceBefore: adjustment.balanceBefore.toNumber(),
    balanceAfter: adjustment.balanceAfter.toNumber(),
    revertsId: adjustment.revertsId,
    revertedById: adjustment.revertedBy?.id ?? null,
    createdAt: adjustment.createdAt.toISOString(),
  };
}
