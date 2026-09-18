/**
 * `monthYear` es siempre `YYYY-MM` y se deriva en hora local del servidor,
 * igual que en `prisma/seed.ts`, para que ambos produzcan la misma clave.
 */
export const MONTH_YEAR_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export const MONTH_YEAR_MESSAGE = 'month must follow the YYYY-MM format';

export function toMonthYear(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function currentMonthYear(): string {
  return toMonthYear(new Date());
}

/** Meses enteros de `from` a `to`, ambos `YYYY-MM`. Negativo si `to` es anterior. */
export function monthsBetween(from: string, to: string): number {
  const [fromYear = 0, fromMonth = 1] = from.split('-').map(Number);
  const [toYear = 0, toMonth = 1] = to.split('-').map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

/**
 * Igual que `toMonthYear`, pero en UTC. Para una fecha-calendario sin hora
 * significativa (ej. `Goal.targetDate`, guardada como `"2027-02-01"`), leerla
 * en hora local del servidor puede correrla un mes hacia atrás: ese string se
 * parsea como medianoche UTC, y en un huso detrás de UTC (Bogotá, UTC-5) cae
 * en el día calendario anterior. Usar esta función para esos casos evita esa
 * trampa; `toMonthYear` sigue siendo correcta para fechas con hora real
 * (`transactionDate`), donde sí importa el día local del usuario.
 */
export function toMonthYearUTC(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** `month` desplazado `delta` meses: `shiftMonth('2026-12', 1)` -> `'2027-01'`. */
export function shiftMonth(month: string, delta: number): string {
  const [year = 0, monthIndex = 1] = month.split('-').map(Number);
  const total = year * 12 + (monthIndex - 1) + delta;
  const nextYear = Math.floor(total / 12);
  const nextMonth = String((total % 12) + 1).padStart(2, '0');
  return `${nextYear}-${nextMonth}`;
}

/**
 * Límites `[start, end)` de un `YYYY-MM` en hora local del servidor — la
 * misma convención que `toMonthYear`, para que un rango de fechas y un
 * `monthYear` derivado con ella coincidan.
 */
export function monthBounds(month: string): { start: Date; end: Date } {
  const [year = 0, monthIndex = 1] = month.split('-').map(Number);
  return {
    start: new Date(year, monthIndex - 1, 1),
    end: new Date(year, monthIndex, 1),
  };
}
