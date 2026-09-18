import { toFinancialCalendarDate } from './period.util';

/**
 * `YYYY-MM`. Ya no agrupa ningún cálculo (eso lo hacen los períodos
 * financieros); queda para `Transaction.monthYear` (deprecado) y para
 * contar meses hasta la fecha objetivo de una meta.
 */
export const MONTH_YEAR_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export const MONTH_YEAR_MESSAGE = 'month must follow the YYYY-MM format';

/** `YYYY-MM` de `date` en hora de Bogotá, igual que los períodos financieros. */
export function toMonthYear(date: Date): string {
  const { year, month } = toFinancialCalendarDate(date);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Meses enteros de `from` a `to`, ambos `YYYY-MM`. Negativo si `to` es anterior. */
export function monthsBetween(from: string, to: string): number {
  const [fromYear = 0, fromMonth = 1] = from.split('-').map(Number);
  const [toYear = 0, toMonth = 1] = to.split('-').map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

/**
 * `YYYY-MM` leído en UTC, para una fecha-calendario sin hora significativa
 * (ej. `Goal.targetDate`, guardada como `"2027-02-01"` = medianoche UTC):
 * leerla en hora de Bogotá la correría al día —y a veces al mes— anterior.
 * Para instantes reales (`transactionDate`) usar `toMonthYear`.
 */
export function toMonthYearUTC(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
