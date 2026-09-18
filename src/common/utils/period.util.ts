/**
 * Los períodos financieros se cortan por día calendario de Colombia, no del
 * servidor: el contenedor corre en UTC, y un gasto de las 8pm en Bogotá ya
 * es el día siguiente en UTC. Colombia no tiene horario de verano, así que un
 * offset fijo es exacto y no depende de que el runtime traiga datos de ICU.
 */
export const FINANCIAL_TIMEZONE_OFFSET_MINUTES = -5 * 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFSET_MS = FINANCIAL_TIMEZONE_OFFSET_MINUTES * 60 * 1000;

const MONTH_LABELS_ES = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const;

/** Medianoche (hora de Colombia) del día en que cae `date`, como instante UTC. */
export function startOfFinancialDay(date: Date): Date {
  const local = date.getTime() + OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - OFFSET_MS);
}

/** Fecha calendario (hora de Colombia) en que cae `date`. `month` es 1-12. */
export function toFinancialCalendarDate(date: Date): {
  year: number;
  month: number;
  day: number;
} {
  const local = new Date(date.getTime() + OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
  };
}

/** Último día (28-31) del mes calendario `month` (1-12) de `year`. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `28 ago 2026`, leído en hora de Colombia. */
export function formatFinancialDay(date: Date): string {
  const local = new Date(date.getTime() + OFFSET_MS);
  const month = MONTH_LABELS_ES[local.getUTCMonth()] ?? '';
  return `${local.getUTCDate()} ${month} ${local.getUTCFullYear()}`;
}

/**
 * Etiqueta legible de un período `[startDate, endDate)`. El último día
 * mostrado es `endDate - 1 día` (el día antes del siguiente salario).
 */
export function formatPeriodLabel(
  startDate: Date,
  endDate: Date | null,
): string {
  const from = formatFinancialDay(startDate);
  if (!endDate) return `${from} – en curso`;
  return `${from} – ${formatFinancialDay(new Date(endDate.getTime() - DAY_MS))}`;
}
