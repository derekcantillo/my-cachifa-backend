/**
 * Opciones de `$transaction` para toda mutación que dispara una cascada de
 * `MonthlyLedger`: un cambio retroactivo recorre varios meses (y sus
 * presupuestos) dentro de una sola transacción, y el timeout por defecto de
 * Prisma (5s) se queda corto.
 */
export const CASCADE_TRANSACTION_OPTIONS = { timeout: 30_000 } as const;
