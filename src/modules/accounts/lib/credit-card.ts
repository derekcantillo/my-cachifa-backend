import { Prisma } from '@prisma/client';
import {
  daysInMonth,
  FINANCIAL_TIMEZONE_OFFSET_MINUTES,
  toFinancialCalendarDate,
} from '@common/utils/period.util';

const ZERO = new Prisma.Decimal(0);
const OFFSET_MS = FINANCIAL_TIMEZONE_OFFSET_MINUTES * 60 * 1000;

export interface CalendarDate {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
}

/**
 * Una tarjeta configurada guarda la deuda como saldo negativo (B.2):
 * `debt = max(0, −saldo)`, `available = max(0, cupo − deuda)` (nunca negativo,
 * como en el extracto) y `overLimit = max(0, deuda − cupo)` (sobrecupo).
 */
export function creditCardFigures(
  currentBalance: Prisma.Decimal,
  creditLimit: Prisma.Decimal,
): {
  debt: Prisma.Decimal;
  available: Prisma.Decimal;
  overLimit: Prisma.Decimal;
} {
  const debt = Prisma.Decimal.max(ZERO, currentBalance.negated());
  return {
    debt,
    available: Prisma.Decimal.max(ZERO, creditLimit.minus(debt)),
    overLimit: Prisma.Decimal.max(ZERO, debt.minus(creditLimit)),
  };
}

/** `YYYY-MM-DD` → fecha calendario, o `null` si no existe (2026-02-30). */
export function parseCalendarDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

export function formatCalendarDate({ year, month, day }: CalendarDate): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * 00:00 en Bogotá del día siguiente a `date`, como instante UTC. Es el ancla de
 * un saldo "al cierre de `date`": todo lo de ese día, a cualquier hora, ya está
 * dentro del extracto y no se vuelve a contar.
 */
export function startOfNextFinancialDay(date: CalendarDate): Date {
  return new Date(
    Date.UTC(date.year, date.month - 1, date.day + 1) - OFFSET_MS,
  );
}

export const compareDates = (a: CalendarDate, b: CalendarDate) =>
  a.year - b.year || a.month - b.month || a.day - b.day;

/** Mes siguiente (o anterior, con `delta` negativo). */
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** El día `day` del mes, o el último si el mes es más corto (31 → 30 nov, 28 feb). */
export function clampedDay(
  year: number,
  month: number,
  day: number,
): CalendarDate {
  return { year, month, day: Math.min(day, daysInMonth(year, month)) };
}

/** Primer corte en `day` o después (ese mismo día incluido). */
export function statementOnOrAfter(
  statementDay: number,
  day: CalendarDate,
): CalendarDate {
  const thisMonth = clampedDay(day.year, day.month, statementDay);
  if (compareDates(thisMonth, day) >= 0) return thisMonth;
  const next = shiftMonth(day.year, day.month, 1);
  return clampedDay(next.year, next.month, statementDay);
}

/** Próximo corte desde `now` (hoy incluido: lo de hoy entra en ese extracto). */
export function nextStatementDate(
  statementDay: number,
  now: Date,
): CalendarDate {
  return statementOnOrAfter(statementDay, toFinancialCalendarDate(now));
}

/**
 * Próximo pago: el del último corte ya cerrado si aún no vence, o si no el del
 * siguiente corte. Cada corte se paga el `paymentDueDay` del mes siguiente.
 */
export function nextPaymentDate(
  statementDay: number,
  paymentDueDay: number,
  now: Date,
): CalendarDate {
  const paymentFor = (cut: { year: number; month: number }) => {
    const due = shiftMonth(cut.year, cut.month, 1);
    return clampedDay(due.year, due.month, paymentDueDay);
  };
  const upcomingCut = nextStatementDate(statementDay, now);
  const lastCutPayment = paymentFor(
    shiftMonth(upcomingCut.year, upcomingCut.month, -1),
  );
  // The upcoming cut is paid the month after it, so it never falls before today.
  return compareDates(lastCutPayment, toFinancialCalendarDate(now)) >= 0
    ? lastCutPayment
    : paymentFor(upcomingCut);
}

/** Tasa efectiva anual en % a partir de la mensual en %: `(1 + m)^12 − 1` (2,1155 → 28,5582). */
export function effectiveAnnualRate(monthlyRate: Prisma.Decimal): number {
  const monthly = monthlyRate.dividedBy(100).plus(1);
  return monthly.pow(12).minus(1).times(100).toDecimalPlaces(4).toNumber();
}
