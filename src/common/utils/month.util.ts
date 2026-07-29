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
