import { AccountType } from '@prisma/client';

/**
 * Ya no se asignan: una tarjeta débito no es una cuenta, es `hasDebitCard` de una
 * cuenta de ahorros, corriente o billetera. Siguen en el enum por las cuentas viejas.
 */
export const RETIRED_ACCOUNT_TYPES: AccountType[] = [AccountType.DEBIT_CARD];

export const RETIRED_ACCOUNT_TYPE_MESSAGE =
  'DEBIT_CARD is no longer an account type: use SAVINGS_ACCOUNT, CHECKING_ACCOUNT or DIGITAL_WALLET with hasDebitCard';

/** Pueden tener tarjeta débito; `DEBIT_CARD` mientras quede alguna cuenta vieja. */
export const DEBIT_CARD_HOLDER_TYPES: AccountType[] = [
  AccountType.SAVINGS_ACCOUNT,
  AccountType.CHECKING_ACCOUNT,
  AccountType.DIGITAL_WALLET,
  AccountType.DEBIT_CARD,
];

export const CARD_LAST4_REGEX = /^\d{4}$/;
export const CARD_LAST4_MESSAGE = 'cardLast4 must be exactly 4 digits';

/** Para booleans del body: `enableImplicitConversion` pasaría `"false"` por `Boolean()` y daría `true`. */
export const rawBodyValue = ({
  obj,
  key,
}: {
  obj: object;
  key: string;
}): unknown => (obj as Record<string, unknown>)[key];
