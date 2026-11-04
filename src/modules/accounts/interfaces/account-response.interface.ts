import type { Account, AccountType, Prisma } from '@prisma/client';

/** Lo que cada consulta de `/accounts` trae de la entidad. */
export const ACCOUNT_INCLUDE = {
  institution: { select: { id: true, name: true } },
} satisfies Prisma.AccountInclude;

export type AccountWithInstitution = Prisma.AccountGetPayload<{
  include: typeof ACCOUNT_INCLUDE;
}>;

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
  /** `null` = sin entidad ("Sin entidad" en Mis productos). */
  institution: { id: string; name: string } | null;
  hasDebitCard: boolean;
  cardLast4: string | null;
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
  account: AccountWithInstitution,
  currentBalance: Prisma.Decimal,
): IAccountResponse {
  return {
    ...toAccountSummaryResponse(account),
    initialBalance: account.initialBalance.toNumber(),
    initialBalanceDate: account.initialBalanceDate
      ? account.initialBalanceDate.toISOString()
      : null,
    currentBalance: currentBalance.toNumber(),
    institution: account.institution,
    hasDebitCard: account.hasDebitCard,
    cardLast4: account.cardLast4,
  };
}
