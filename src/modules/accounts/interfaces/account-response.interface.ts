import { AccountType, type Account, type Prisma } from '@prisma/client';
import { toFinancialCalendarDate } from '@common/utils/period.util';
import {
  summarizeCardPlans,
  type CardPlanRow,
} from '@modules/installment-plans/lib/installment-schedule';
import {
  creditCardFigures,
  effectiveAnnualRate,
  formatCalendarDate,
  nextPaymentDate,
  nextStatementDate,
} from '../lib/credit-card';

/** Lo que cada consulta de `/accounts` trae de la entidad y de los planes de cuotas. */
export const ACCOUNT_INCLUDE = {
  institution: { select: { id: true, name: true } },
  installmentPlans: {
    select: {
      principal: true,
      installmentCount: true,
      monthlyRate: true,
      firstStatementDate: true,
      billedBeforeTracking: true,
      recognizeInstallments: true,
      status: true,
      settlementInstallment: true,
      transactions: { select: { installmentNumber: true } },
    },
  },
} satisfies Prisma.AccountInclude;

/** `installmentPlans` es opcional: sin él, el bloque `creditCard` dice 0 planes. */
export type AccountWithInstitution = Prisma.AccountGetPayload<{
  include: { institution: typeof ACCOUNT_INCLUDE.institution };
}> & { installmentPlans?: CardPlanRow[] };

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
  /** Solo en `CREDIT_CARD`; `null` en las demás cuentas. */
  creditCard: ICreditCardResponse | null;
}

/**
 * Estado de una tarjeta. Sin cupo (`configured: false`) su saldo no tiene un
 * signo confiable, así que deuda, disponible y sobrecupo van en `null`.
 */
export interface ICreditCardResponse {
  /** `creditLimit != null`. */
  configured: boolean;
  creditLimit: number | null;
  statementDay: number | null;
  paymentDueDay: number | null;
  /** % mensual. */
  defaultMonthlyRate: number | null;
  /** % efectivo anual, calculado de la tasa mensual. */
  defaultEffectiveAnnualRate: number | null;
  /** `max(0, −currentBalance)`. */
  debt: number | null;
  /** `max(0, creditLimit − debt)`: nunca negativo. */
  available: number | null;
  /** `max(0, debt − creditLimit)`: sobrecupo. */
  overLimit: number | null;
  /** `YYYY-MM-DD` (Bogotá); `null` sin `statementDay`. */
  nextStatementDate: string | null;
  /** `YYYY-MM-DD` (Bogotá); `null` sin `statementDay` o `paymentDueDay`. */
  nextPaymentDate: string | null;
  /** Planes de cuotas activos (ni terminados ni liquidados). */
  activePlans: number;
  /** Capital de cuotas que falta por facturar. Ya está dentro de `debt`, como en el extracto. */
  remainingInstallmentPrincipal: number;
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

export function toCreditCardResponse(
  account: Account & { installmentPlans?: CardPlanRow[] },
  currentBalance: Prisma.Decimal,
  now: Date,
): ICreditCardResponse {
  const { creditLimit, statementDay, paymentDueDay, defaultMonthlyRate } =
    account;
  const plans = summarizeCardPlans(
    account.installmentPlans ?? [],
    statementDay === null || paymentDueDay === null
      ? null
      : { statementDay, paymentDueDay },
    toFinancialCalendarDate(now),
  );
  const figures = creditLimit
    ? creditCardFigures(currentBalance, creditLimit)
    : null;
  return {
    configured: creditLimit !== null,
    creditLimit: creditLimit?.toNumber() ?? null,
    statementDay,
    paymentDueDay,
    defaultMonthlyRate: defaultMonthlyRate?.toNumber() ?? null,
    defaultEffectiveAnnualRate: defaultMonthlyRate
      ? effectiveAnnualRate(defaultMonthlyRate)
      : null,
    debt: figures?.debt.toNumber() ?? null,
    available: figures?.available.toNumber() ?? null,
    overLimit: figures?.overLimit.toNumber() ?? null,
    nextStatementDate:
      statementDay === null
        ? null
        : formatCalendarDate(nextStatementDate(statementDay, now)),
    nextPaymentDate:
      statementDay === null || paymentDueDay === null
        ? null
        : formatCalendarDate(nextPaymentDate(statementDay, paymentDueDay, now)),
    activePlans: plans.activePlans,
    remainingInstallmentPrincipal: plans.remainingPrincipal.toNumber(),
  };
}

export function toAccountResponse(
  account: AccountWithInstitution,
  currentBalance: Prisma.Decimal,
  now: Date = new Date(),
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
    creditCard:
      account.type === AccountType.CREDIT_CARD
        ? toCreditCardResponse(account, currentBalance, now)
        : null,
  };
}
