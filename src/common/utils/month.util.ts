import { toFinancialCalendarDate } from './period.util';

/**
 * `YYYY-MM`. Ya no agrupa ningún cálculo (eso lo hacen los períodos
 * financieros); queda solo para `Transaction.monthYear` (deprecado).
 */
export const MONTH_YEAR_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export const MONTH_YEAR_MESSAGE = 'month must follow the YYYY-MM format';

/** `YYYY-MM` de `date` en hora de Bogotá, igual que los períodos financieros. */
export function toMonthYear(date: Date): string {
  const { year, month } = toFinancialCalendarDate(date);
  return `${year}-${String(month).padStart(2, '0')}`;
}
