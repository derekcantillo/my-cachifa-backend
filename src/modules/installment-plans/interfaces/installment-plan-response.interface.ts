import type {
  Category,
  InstallmentPlanKind,
  InstallmentPlan,
} from '@prisma/client';
import { formatCalendarDate } from '@modules/accounts/lib/credit-card';
import {
  fromDbDate,
  type InstallmentState,
  type PlanStatusView,
  type PlanView,
} from '../lib/installment-schedule';

export interface IInstallmentPlanResponse {
  id: string;
  accountId: string;
  account: { id: string; name: string };
  kind: InstallmentPlanKind;
  description: string;
  category: Category | null;
  principal: number;
  installmentCount: number;
  /** % mensual del plan. */
  monthlyRate: number;
  /** % efectivo anual de `monthlyRate`. */
  effectiveAnnualRate: number;
  /** `YYYY-MM-DD`. */
  startDate: string;
  /** `YYYY-MM-DD`: el corte (día de corte de la tarjeta) que factura la cuota 1. */
  firstStatementDate: string;
  billedBeforeTracking: number;
  recognizeInstallments: boolean;
  status: PlanStatusView;
  settledAt: string | null;
  /** Capital de cada cuota (la última puede variar por el redondeo). */
  installmentAmount: number;
  /** Cuotas facturadas hasta hoy: "va en la 9/24". */
  currentInstallment: number;
  /** Capital que falta por facturar (0 si se liquidó). */
  remainingPrincipal: number;
  estimatedRemainingInterest: number;
  /** El `FINANCED_PURCHASE` de un `PURCHASE`; `null` en `LEGACY` y `REFINANCE`. */
  financedPurchaseTransactionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IInstallmentScheduleItem {
  number: number;
  statementDate: string;
  dueDate: string;
  principal: number;
  estimatedInterest: number;
  state: InstallmentState;
  transactionId: string | null;
  /** Lo reconocido como gasto; en la liquidación, todo el capital restante. */
  recognizedAmount: number | null;
}

export interface IInstallmentPlanDetail extends IInstallmentPlanResponse {
  schedule: IInstallmentScheduleItem[];
}

/** Una cuota facturada y sin reconocer que vence en el período ("Fijos por registrar"). */
export interface IPendingInstallment {
  planId: string;
  kind: InstallmentPlanKind;
  number: number;
  installmentCount: number;
  description: string;
  category: Category | null;
  accountId: string;
  accountName: string;
  statementDate: string;
  dueDate: string;
  principal: number;
  estimatedInterest: number;
}

/** Lo que devuelve `POST /installment-plans/pending/register`: cada cuota con su gasto. */
export interface IRegisteredInstallment extends IPendingInstallment {
  transactionId: string;
}

export function toInstallmentPlanResponse(
  plan: InstallmentPlan & { account: { id: string; name: string } },
  view: PlanView,
  effectiveAnnualRate: number,
  financedPurchaseTransactionId: string | null,
): IInstallmentPlanResponse {
  return {
    id: plan.id,
    accountId: plan.accountId,
    account: { id: plan.account.id, name: plan.account.name },
    kind: plan.kind,
    description: plan.description,
    category: plan.category,
    principal: plan.principal.toNumber(),
    installmentCount: plan.installmentCount,
    monthlyRate: plan.monthlyRate.toNumber(),
    effectiveAnnualRate,
    startDate: formatCalendarDate(fromDbDate(plan.startDate)),
    firstStatementDate: formatCalendarDate(fromDbDate(plan.firstStatementDate)),
    billedBeforeTracking: plan.billedBeforeTracking,
    recognizeInstallments: plan.recognizeInstallments,
    status: view.status,
    settledAt: plan.settledAt
      ? formatCalendarDate(fromDbDate(plan.settledAt))
      : null,
    installmentAmount: view.installmentAmount.toNumber(),
    currentInstallment: view.currentInstallment,
    remainingPrincipal: view.remainingPrincipal.toNumber(),
    estimatedRemainingInterest: view.estimatedRemainingInterest.toNumber(),
    financedPurchaseTransactionId,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

export function toScheduleItems(view: PlanView): IInstallmentScheduleItem[] {
  return view.schedule.map((item) => ({
    number: item.number,
    statementDate: formatCalendarDate(item.statementDate),
    dueDate: formatCalendarDate(item.dueDate),
    principal: item.principal.toNumber(),
    estimatedInterest: item.estimatedInterest.toNumber(),
    state: item.state,
    transactionId: item.transactionId,
    recognizedAmount: item.recognizedAmount?.toNumber() ?? null,
  }));
}
