import type { Account, AccountType, Prisma } from '@prisma/client';

/** Lo que trae un `Transaction` al incluir su cuenta — sin `currentBalance`, que solo tiene sentido calculado una vez por cuenta, no repetido por cada movimiento. */
export interface IAccountSummaryResponse {
  id: string;
  name: string;
  type: AccountType;
  createdAt: string;
  updatedAt: string;
}

export interface IAccountResponse extends IAccountSummaryResponse {
  initialBalance: number;
  initialBalanceDate: string | null;
  /** `initialBalance` más el efecto de todo movimiento desde `initialBalanceDate` (o desde siempre, si no hay una). */
  currentBalance: number;
}

export function toAccountSummaryResponse(
  account: Account,
): IAccountSummaryResponse {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

export function toAccountResponse(
  account: Account,
  currentBalance: Prisma.Decimal,
): IAccountResponse {
  return {
    ...toAccountSummaryResponse(account),
    initialBalance: account.initialBalance.toNumber(),
    initialBalanceDate: account.initialBalanceDate
      ? account.initialBalanceDate.toISOString()
      : null,
    currentBalance: currentBalance.toNumber(),
  };
}
