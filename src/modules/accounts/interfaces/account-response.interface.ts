import type { Account, AccountType } from '@prisma/client';

export interface IAccountResponse {
  id: string;
  name: string;
  type: AccountType;
  createdAt: string;
  updatedAt: string;
}

export function toAccountResponse(account: Account): IAccountResponse {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}
