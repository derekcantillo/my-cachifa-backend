import { GoalStatus, Prisma, type Goal } from '@prisma/client';
import { toFinancialCalendarDate } from '@common/utils/period.util';

/** Día calendario suelto, sin hora. `month` es 1-12. */
interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/**
 * Plan de aporte de una meta. Se calcula al leer (no se guarda), así que
 * siempre refleja el día en que se consulta.
 */
export interface IGoalPlan {
  /** Meses completos que faltan para la fecha objetivo. Mínimo 1; 0 si ya venció. */
  monthsRemaining: number;
  /** `ceil(restante / monthsRemaining)`, en unidades enteras de moneda. */
  requiredMonthlyContribution: number;
  /** La fecha objetivo ya pasó y la meta sigue activa. */
  isOverdue: boolean;
}

/** Lo único que necesita `calculateGoalPlan` de una `Goal`. */
export type GoalPlanInput = Pick<
  Goal,
  'targetAmount' | 'currentAmount' | 'targetDate' | 'status'
>;

const ZERO = new Prisma.Decimal(0);

/** Piso de meses restantes: evita dividir por cero el mes en que vence la meta. */
const MIN_MONTHS_REMAINING = 1;

/**
 * `Goal.targetDate` es una fecha calendario sin hora significativa, guardada
 * como medianoche UTC (ej. `"2027-02-01"` → `2027-02-01T00:00:00Z`). Leerla en
 * hora de Bogotá la correría al día —y a veces al mes— anterior, así que se lee
 * en UTC. Para instantes reales (`now`) sí se usa la hora de Bogotá.
 */
function toTargetCalendarDate(targetDate: Date): CalendarDate {
  return {
    year: targetDate.getUTCFullYear(),
    month: targetDate.getUTCMonth() + 1,
    day: targetDate.getUTCDate(),
  };
}

/** Negativo si `a` es anterior a `b`, 0 si es el mismo día. */
function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/**
 * ÚNICA fuente del aporte mensual que exige una meta: la usan el endpoint de
 * metas (campo `plan`) y la alerta `SAVINGS_TARGET_AT_RISK`. No duplicar esta
 * fórmula en ningún otro lado.
 *
 * - `hoy` es el día calendario de Bogotá de `now`; el objetivo se lee en UTC.
 * - `restante = max(0, targetAmount − currentAmount)`.
 * - Metas que no están `ACTIVE` no tienen plan.
 * - Vencida: el restante se exige completo, en un solo aporte.
 * - Si no: meses completos hasta el objetivo (descontando uno si el día del
 *   mes objetivo aún no llegó), con piso de 1, y el aporte se redondea hacia
 *   arriba para que la suma de los aportes nunca quede corta.
 */
export function calculateGoalPlan(
  goal: GoalPlanInput,
  now: Date,
): IGoalPlan | null {
  if (goal.status !== GoalStatus.ACTIVE) return null;

  const remaining = Prisma.Decimal.max(
    ZERO,
    goal.targetAmount.minus(goal.currentAmount),
  );

  const today = toFinancialCalendarDate(now);
  const target = toTargetCalendarDate(goal.targetDate);

  if (compareCalendarDates(target, today) < 0) {
    return {
      monthsRemaining: 0,
      requiredMonthlyContribution: remaining.toNumber(),
      isOverdue: true,
    };
  }

  const wholeMonths =
    (target.year - today.year) * 12 +
    (target.month - today.month) -
    (target.day < today.day ? 1 : 0);
  const monthsRemaining = Math.max(MIN_MONTHS_REMAINING, wholeMonths);

  return {
    monthsRemaining,
    requiredMonthlyContribution: remaining
      .div(monthsRemaining)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_CEIL)
      .toNumber(),
    isOverdue: false,
  };
}
