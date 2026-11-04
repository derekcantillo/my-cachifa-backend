import { TransactionType } from '@prisma/client';

/**
 * Tipos que solo nacen y se mantienen desde `/installment-plans`, junto con su
 * plan. `/transactions` no los crea; tampoco edita ni borra las cuotas
 * reconocidas (filas con `installmentPlanId`).
 */
export const INSTALLMENT_MOVEMENT_TYPES: TransactionType[] = [
  TransactionType.FINANCED_PURCHASE,
];

export const INSTALLMENT_MOVEMENT_TYPE_MESSAGE =
  'Financed purchases are created from /installment-plans';

export const INSTALLMENT_MOVEMENT_LOCKED_MESSAGE =
  'Installment movements are managed from /installment-plans';
