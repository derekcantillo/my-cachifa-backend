const COP_FORMATTER = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

/** `1000000` -> `"$ 1.000.000"`, para mensajes de Alert de cara al usuario. */
export function formatCOP(amount: number): string {
  return COP_FORMATTER.format(amount);
}
