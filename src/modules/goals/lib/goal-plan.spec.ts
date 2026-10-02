import { GoalStatus, Prisma } from '@prisma/client';
import { calculateGoalPlan, type GoalPlanInput } from './goal-plan';

/**
 * `targetDate` se construye con `new Date('YYYY-MM-DD')` igual que el seed y
 * que el DTO (`@IsDateString`): medianoche UTC, que la función lee en UTC.
 */
function goal(overrides: Partial<GoalPlanInput> = {}): GoalPlanInput {
  return {
    targetAmount: new Prisma.Decimal(3_000_000),
    currentAmount: new Prisma.Decimal(0),
    targetDate: new Date('2027-01-01'),
    status: GoalStatus.ACTIVE,
    ...overrides,
  };
}

/** Mediodía de Bogotá del día indicado, como instante UTC. */
function bogotaNoon(day: string): Date {
  return new Date(`${day}T17:00:00Z`);
}

describe('calculateGoalPlan', () => {
  describe('meses restantes', () => {
    it('cuenta 3 meses del 1 de octubre al 1 de enero', () => {
      const plan = calculateGoalPlan(
        goal({ targetDate: new Date('2027-01-01') }),
        bogotaNoon('2026-10-01'),
      );

      expect(plan).toEqual({
        monthsRemaining: 3,
        requiredMonthlyContribution: 1_000_000,
        isOverdue: false,
      });
    });

    it('cuenta 5 meses del 1 de octubre al 1 de marzo', () => {
      const plan = calculateGoalPlan(
        goal({ targetDate: new Date('2027-03-01') }),
        bogotaNoon('2026-10-01'),
      );

      expect(plan?.monthsRemaining).toBe(5);
    });

    it('cruza el fin de año sin perder meses', () => {
      const plan = calculateGoalPlan(
        goal({ targetDate: new Date('2028-02-15') }),
        bogotaNoon('2026-11-20'),
      );

      // 2026-11-20 → 2028-02-15: 15 meses de calendario, menos 1 porque el
      // día 15 del mes objetivo es anterior al día 20 de hoy.
      expect(plan?.monthsRemaining).toBe(14);
    });

    it('descuenta el mes incompleto: 31 de enero al 28 de febrero es 1 mes', () => {
      const plan = calculateGoalPlan(
        goal({ targetDate: new Date('2027-02-28') }),
        bogotaNoon('2027-01-31'),
      );

      expect(plan?.monthsRemaining).toBe(1);
    });

    it('usa el piso de 1 mes cuando el objetivo cae dentro del mes en curso', () => {
      const plan = calculateGoalPlan(
        goal({ targetDate: new Date('2026-10-15') }),
        bogotaNoon('2026-10-01'),
      );

      expect(plan).toEqual({
        monthsRemaining: 1,
        requiredMonthlyContribution: 3_000_000,
        isOverdue: false,
      });
    });

    it('el mismo día del objetivo da 1 mes y no está vencida', () => {
      const plan = calculateGoalPlan(
        goal({ targetDate: new Date('2026-10-01') }),
        bogotaNoon('2026-10-01'),
      );

      expect(plan).toEqual({
        monthsRemaining: 1,
        requiredMonthlyContribution: 3_000_000,
        isOverdue: false,
      });
    });

    it('lee el día de hoy en hora de Bogotá, no en UTC', () => {
      // 04:30Z del 1 de octubre todavía es el 30 de septiembre en Bogotá: al
      // 30 de diciembre le faltan 3 meses completos (sep 30 → dic 30). Leído
      // en UTC el hoy sería el 1 de octubre y darían solo 2.
      const plan = calculateGoalPlan(
        goal({ targetDate: new Date('2026-12-30') }),
        new Date('2026-10-01T04:30:00Z'),
      );

      expect(plan?.monthsRemaining).toBe(3);
    });
  });

  describe('metas vencidas', () => {
    it('exige el restante completo si el objetivo fue ayer', () => {
      const plan = calculateGoalPlan(
        goal({
          targetDate: new Date('2026-09-30'),
          currentAmount: new Prisma.Decimal(500_000),
        }),
        bogotaNoon('2026-10-01'),
      );

      expect(plan).toEqual({
        monthsRemaining: 0,
        requiredMonthlyContribution: 2_500_000,
        isOverdue: true,
      });
    });

    it('no marca como vencida una meta cuyo objetivo es hoy en Bogotá', () => {
      // 2026-10-01T02:00:00Z = 30 sep 21:00 en Bogotá: el objetivo del 30 de
      // septiembre es hoy, no ayer.
      const plan = calculateGoalPlan(
        goal({ targetDate: new Date('2026-09-30') }),
        new Date('2026-10-01T02:00:00Z'),
      );

      expect(plan?.isOverdue).toBe(false);
    });
  });

  describe('restante', () => {
    it('es 0 cuando ya se alcanzó el monto objetivo', () => {
      const plan = calculateGoalPlan(
        goal({
          targetAmount: new Prisma.Decimal(3_000_000),
          currentAmount: new Prisma.Decimal(3_000_000),
        }),
        bogotaNoon('2026-10-01'),
      );

      expect(plan).toEqual({
        monthsRemaining: 3,
        requiredMonthlyContribution: 0,
        isOverdue: false,
      });
    });

    it('nunca es negativo si se aportó de más', () => {
      const plan = calculateGoalPlan(
        goal({
          targetAmount: new Prisma.Decimal(3_000_000),
          currentAmount: new Prisma.Decimal(4_000_000),
        }),
        bogotaNoon('2026-10-01'),
      );

      expect(plan?.requiredMonthlyContribution).toBe(0);
    });

    it('redondea el aporte hacia arriba a la unidad de moneda', () => {
      const plan = calculateGoalPlan(
        goal({ targetAmount: new Prisma.Decimal(10_000_000) }),
        bogotaNoon('2026-10-01'),
      );

      // 10.000.000 / 3 = 3.333.333,33 → 3.333.334, para que tres aportes
      // cubran la meta y no queden $1 cortos.
      expect(plan?.requiredMonthlyContribution).toBe(3_333_334);
    });
  });

  describe('metas que no están activas', () => {
    it('no tiene plan si está en PAUSED', () => {
      expect(
        calculateGoalPlan(
          goal({ status: GoalStatus.PAUSED }),
          bogotaNoon('2026-10-01'),
        ),
      ).toBeNull();
    });

    it('no tiene plan si está en COMPLETED', () => {
      expect(
        calculateGoalPlan(
          goal({ status: GoalStatus.COMPLETED }),
          bogotaNoon('2026-10-01'),
        ),
      ).toBeNull();
    });
  });
});
