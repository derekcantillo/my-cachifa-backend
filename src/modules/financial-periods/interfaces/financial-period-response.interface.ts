import type { FinancialPeriod } from '@prisma/client';

export interface IFinancialPeriodResponse {
  id: string;
  /** `28 ago 2026 – 27 sep 2026`, o `28 ago 2026 – en curso` si está abierto. */
  label: string;
  /** Medianoche (hora de Bogotá) del día del salario que lo abrió. */
  startDate: string;
  /**
   * Inicio del período siguiente (exclusivo): el último día incluido es el
   * anterior. `null` para el período abierto actual.
   */
  endDate: string | null;
}

export function toFinancialPeriodResponse(
  period: FinancialPeriod,
): IFinancialPeriodResponse {
  return {
    id: period.id,
    label: period.label,
    startDate: period.startDate.toISOString(),
    endDate: period.endDate?.toISOString() ?? null,
  };
}
