import type {
  Account,
  Category,
  Transaction,
  TransactionType,
} from '@prisma/client';
import {
  toAccountResponse,
  type IAccountResponse,
} from '@modules/accounts/interfaces/account-response.interface';

export type TransactionWithAccount = Transaction & { account: Account | null };

/**
 * Los montos viajan como `number` en JSON (el móvil los consume así); en base
 * de datos siguen siendo `Decimal(12,2)`.
 */
export interface ITransactionResponse {
  id: string;
  amount: number;
  type: TransactionType;
  category: Category;
  description: string | null;
  tags: string[];
  accountId: string | null;
  account: IAccountResponse | null;
  transactionDate: string;
  monthYear: string;
  createdAt: string;
  updatedAt: string;
}

export function toTransactionResponse(
  transaction: TransactionWithAccount,
): ITransactionResponse {
  return {
    id: transaction.id,
    amount: transaction.amount.toNumber(),
    type: transaction.type,
    category: transaction.category,
    description: transaction.description,
    tags: transaction.tags,
    accountId: transaction.accountId,
    account: transaction.account
      ? toAccountResponse(transaction.account)
      : null,
    transactionDate: transaction.transactionDate.toISOString(),
    monthYear: transaction.monthYear,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}
