import { TransactionType } from '@prisma/client';

/**
 * Tipos que solo nacen y se mantienen desde `/loans`, junto con su `Loan`.
 * `/transactions` no los crea, ni los edita, ni los borra.
 */
export const LOAN_MOVEMENT_TYPES: TransactionType[] = [
  TransactionType.LOAN_GIVEN,
  TransactionType.LOAN_REPAYMENT,
];

export const LOAN_MOVEMENT_TYPE_MESSAGE =
  'LOAN_GIVEN and LOAN_REPAYMENT movements are created from /loans';
