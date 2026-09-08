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
