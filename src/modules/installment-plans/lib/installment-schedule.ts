import { Prisma } from '@prisma/client';
import {
  FINANCIAL_TIMEZONE_OFFSET_MINUTES,
  toFinancialCalendarDate,
} from '@common/utils/period.util';
import {
  clampedDay,
  compareDates,
  shiftMonth,
  type CalendarDate,
} from '@modules/accounts/lib/credit-card';

const ZERO = new Prisma.Decimal(0);
const OFFSET_MS = FINANCIAL_TIMEZONE_OFFSET_MINUTES * 60 * 1000;

/** Lo que define el calendario de un plan (docs/design-liabilities.md D.2). */
export interface PlanTerms {
  principal: Prisma.Decimal;
  installmentCount: number;
  /** % mensual. */
  monthlyRate: Prisma.Decimal;
  /** Solo cuenta el mes: el día es el de corte de la tarjeta. */
  firstStatementDate: CalendarDate;
}

/** Días de corte y de pago de la tarjeta (1-31; 31 = último día del mes). */
export interface CardCycle {
  statementDay: number;
  paymentDueDay: number;
}

export interface ScheduledInstallment {
  number: number;
  /** Corte que factura la cuota. */
  statementDate: CalendarDate;
  /** Día de pago del mes siguiente al corte: cuando la cuota cuenta como gasto. */
  dueDate: CalendarDate;
  /** Capital de la cuota (`principal / N`; la última absorbe el redondeo). */
  principal: Prisma.Decimal;
  /** Capital financiado pendiente antes de esta cuota. */
  principalBefore: Prisma.Decimal;
  /** `principalBefore × tasa`: una estimación, el interés real lo dice el extracto. */
  estimatedInterest: Prisma.Decimal;
}

export type InstallmentState =
  /** Ya se pagó antes de que la app conociera el plan. */
  | 'BILLED_BEFORE_TRACKING'
  /** Tiene su `EXPENSE` (o entró en la liquidación). */
  | 'RECOGNIZED'
  /** Facturada y sin reconocer: aparece en "Fijos por registrar". */
  | 'PENDING'
  /** Todavía no se factura. */
  | 'FUTURE'
  /** El plan no cuenta sus cuotas como gasto. */
  | 'NOT_RECOGNIZED'
  /** Cubierta por la liquidación del plan. */
  | 'SETTLED';

export type PlanStatusView = 'ACTIVE' | 'FINISHED' | 'SETTLED';

export interface PlanState {
  status: 'ACTIVE' | 'SETTLED';
  billedBeforeTracking: number;
  recognizeInstallments: boolean;
  /** Al liquidar, la cuota que recibió todo el capital restante. */
  settlementInstallment: number | null;
}

export interface RecognizedInstallment {
  number: number;
  transactionId: string;
  amount: Prisma.Decimal;
  transactionDate: Date;
}

export interface InstallmentView extends ScheduledInstallment {
  state: InstallmentState;
  transactionId: string | null;
  /** Lo que se reconoció como gasto (en la liquidación, todo el capital restante). */
  recognizedAmount: Prisma.Decimal | null;
}

export interface PlanView {
  installmentAmount: Prisma.Decimal;
  schedule: InstallmentView[];
  /** Cuotas facturadas hasta hoy ("va en la 9/24"). */
  currentInstallment: number;
  /** Capital que falta por facturar; 0 si se liquidó. */
  remainingPrincipal: Prisma.Decimal;
  estimatedRemainingInterest: Prisma.Decimal;
  status: PlanStatusView;
}

const toMoney = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Capital de cada cuota menos la última: `principal / N`, a 2 decimales. */
export function installmentAmount(
  principal: Prisma.Decimal,
  installmentCount: number,
): Prisma.Decimal {
  return toMoney(principal.dividedBy(installmentCount));
}

/** El corte del mes de `date` según el día de corte de la tarjeta. */
export function normalizeStatementDate(
  date: CalendarDate,
  statementDay: number,
): CalendarDate {
  return clampedDay(date.year, date.month, statementDay);
}

/**
 * Calendario completo (D.2): la cuota k se factura en el corte del mes
 * `firstStatementDate + (k − 1)` y vence el día de pago del mes siguiente. Es
 * solo capital y constante; el interés se estima sobre el capital pendiente.
 */
export function buildSchedule(
  terms: PlanTerms,
  cycle: CardCycle,
): ScheduledInstallment[] {
  const amount = installmentAmount(terms.principal, terms.installmentCount);
  const rate = terms.monthlyRate.dividedBy(100);
  const schedule: ScheduledInstallment[] = [];
  let principalBefore = terms.principal;

  for (let number = 1; number <= terms.installmentCount; number++) {
    const cut = shiftMonth(
      terms.firstStatementDate.year,
      terms.firstStatementDate.month,
      number - 1,
    );
    const due = shiftMonth(cut.year, cut.month, 1);
    const principal =
      number === terms.installmentCount ? principalBefore : amount;
    schedule.push({
      number,
      statementDate: clampedDay(cut.year, cut.month, cycle.statementDay),
      dueDate: clampedDay(due.year, due.month, cycle.paymentDueDay),
      principal,
      principalBefore,
      estimatedInterest: toMoney(principalBefore.times(rate)),
    });
    principalBefore = principalBefore.minus(principal);
  }
  return schedule;
}

/** Estado de cada cuota, cuota actual y capital restante, vistos desde `today` (Bogotá). */
export function describePlan(
  terms: PlanTerms,
  cycle: CardCycle,
  plan: PlanState,
  recognized: readonly RecognizedInstallment[],
  today: CalendarDate,
): PlanView {
  const byNumber = new Map(recognized.map((item) => [item.number, item]));
  const settled = plan.status === 'SETTLED';
  const schedule = buildSchedule(terms, cycle).map(
    (installment): InstallmentView => {
      const record = byNumber.get(installment.number);
      const billed = compareDates(installment.statementDate, today) <= 0;
      let state: InstallmentState;
      if (installment.number <= plan.billedBeforeTracking) {
        state = 'BILLED_BEFORE_TRACKING';
      } else if (record) {
        state = 'RECOGNIZED';
      } else if (settled) {
        state = 'SETTLED';
      } else if (!plan.recognizeInstallments) {
        state = 'NOT_RECOGNIZED';
      } else {
        state = billed ? 'PENDING' : 'FUTURE';
      }
      return {
        ...installment,
        state,
        transactionId: record?.transactionId ?? null,
        recognizedAmount: record?.amount ?? null,
      };
    },
  );

  const billed = schedule.filter(
    (installment) => compareDates(installment.statementDate, today) <= 0,
  );
  const unbilled = schedule.slice(billed.length);
  const sum = (values: Prisma.Decimal[]) =>
    values.reduce((total, value) => total.plus(value), ZERO);
  const currentInstallment = billed.length;
  const hasPending = schedule.some(({ state }) => state === 'PENDING');

  return {
    installmentAmount: installmentAmount(
      terms.principal,
      terms.installmentCount,
    ),
    schedule,
    currentInstallment,
    remainingPrincipal: settled
      ? ZERO
      : terms.principal.minus(sum(billed.map(({ principal }) => principal))),
    estimatedRemainingInterest: settled
      ? ZERO
      : sum(unbilled.map(({ estimatedInterest }) => estimatedInterest)),
    status: settled
      ? 'SETTLED'
      : currentInstallment === terms.installmentCount && !hasPending
        ? 'FINISHED'
        : 'ACTIVE',
  };
}

/** 12:00 de Bogotá de `date`: la hora con que se guardan las cuotas reconocidas. */
export function financialNoon(date: CalendarDate): Date {
  return new Date(
    Date.UTC(date.year, date.month - 1, date.day, 12) - OFFSET_MS,
  );
}

/** Columna `@db.Date` ↔ fecha calendario (Prisma la entrega a las 00:00 UTC). */
export function fromDbDate(date: Date): CalendarDate {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function toDbDate(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

/**
 * Fin de un período para las cuotas: su `endDate`, o en el período abierto el
 * siguiente salario esperado (un mes después del inicio), o mañana si ese día
 * ya pasó sin salario: mientras siga abierto, todo lo de hoy cae en él.
 */
export function periodRangeEnd(
  period: { startDate: Date; endDate: Date | null },
  now: Date,
): Date {
  if (period.endDate) return period.endDate;
  const start = toFinancialCalendarDate(period.startDate);
  const next = shiftMonth(start.year, start.month, 1);
  const expected = clampedDay(next.year, next.month, start.day);
  const today = toFinancialCalendarDate(now);
  const tomorrow = { ...today, day: today.day + 1 };
  const startOf = (date: CalendarDate) =>
    new Date(Date.UTC(date.year, date.month - 1, date.day) - OFFSET_MS);
  return new Date(
    Math.max(startOf(expected).getTime(), startOf(tomorrow).getTime()),
  );
}

/** Si el instante cae en `[start, end)`. */
export function inRange(instant: Date, start: Date, end: Date): boolean {
  return instant >= start && instant < end;
}

/** Lo que un plan necesita para saber qué cuotas caen en un período. */
export interface PlanCharges {
  terms: PlanTerms;
  /** `null` si la tarjeta perdió sus días: solo cuentan las cuotas ya reconocidas. */
  cycle: CardCycle | null;
  state: PlanState;
  recognized: readonly RecognizedInstallment[];
}

/**
 * Capital de cuotas del plan que cae en `[start, end)` para la base del
 * presupuesto (D.4), registradas o no: las reconocidas por la fecha de su
 * gasto (la liquidación incluida), las demás por su fecha de pago. Las
 * anteriores a `billedBeforeTracking` y las que cubrió una liquidación no
 * cuentan.
 */
export function installmentChargesInRange(
  plan: PlanCharges,
  start: Date,
  end: Date,
): Prisma.Decimal {
  if (!plan.state.recognizeInstallments) return ZERO;
  let total = ZERO;
  for (const record of plan.recognized) {
    if (inRange(record.transactionDate, start, end)) {
      total = total.plus(record.amount);
    }
  }
  if (!plan.cycle || plan.state.status === 'SETTLED') return total;

  const recognized = new Set(plan.recognized.map(({ number }) => number));
  for (const installment of buildSchedule(plan.terms, plan.cycle)) {
    if (
      installment.number > plan.state.billedBeforeTracking &&
      !recognized.has(installment.number) &&
      inRange(financialNoon(installment.dueDate), start, end)
    ) {
      total = total.plus(installment.principal);
    }
  }
  return total;
}
