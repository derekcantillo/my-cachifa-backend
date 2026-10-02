import { GoalStatus, PlanPhase, Prisma } from '@prisma/client';
import {
  toGoalResponse,
  type GoalWithContributions,
} from './goal-response.interface';

const CREATED_AT = new Date('2026-09-01T15:00:00Z');

function goalRow(
  overrides: Partial<GoalWithContributions> = {},
): GoalWithContributions {
  return {
    id: 'goal_1',
    userId: 'user_1',
    name: 'Fondo de emergencia',
    targetAmount: new Prisma.Decimal(3_000_000),
    currentAmount: new Prisma.Decimal(750_000),
    targetDate: new Date('2027-01-01'),
    phase: PlanPhase.PHASE_2_OPTIMIZATION,
    status: GoalStatus.ACTIVE,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    contributions: [
      {
        id: 'contribution_1',
        goalId: 'goal_1',
        amount: new Prisma.Decimal(750_000),
        note: 'primer aporte',
        contributedAt: CREATED_AT,
        createdAt: CREATED_AT,
      },
    ],
    ...overrides,
  };
}

describe('toGoalResponse', () => {
  const now = new Date('2026-10-01T17:00:00Z');

  it('conserva intactos los campos que ya exponía y solo agrega `plan`', () => {
    const response = toGoalResponse(goalRow(), now);

    // La app móvil instalada depende de esta forma exacta: `plan` es aditivo.
    expect(response).toEqual({
      id: 'goal_1',
      name: 'Fondo de emergencia',
      targetAmount: 3_000_000,
      currentAmount: 750_000,
      percentage: 25,
      targetDate: '2027-01-01T00:00:00.000Z',
      phase: PlanPhase.PHASE_2_OPTIMIZATION,
      status: GoalStatus.ACTIVE,
      plan: {
        monthsRemaining: 3,
        requiredMonthlyContribution: 750_000,
        isOverdue: false,
      },
      contributions: [
        {
          id: 'contribution_1',
          amount: 750_000,
          note: 'primer aporte',
          contributedAt: '2026-09-01T15:00:00.000Z',
          createdAt: '2026-09-01T15:00:00.000Z',
        },
      ],
      createdAt: '2026-09-01T15:00:00.000Z',
      updatedAt: '2026-09-01T15:00:00.000Z',
    });
  });

  it('deja `plan` en null para una meta que no está activa', () => {
    const response = toGoalResponse(
      goalRow({ status: GoalStatus.PAUSED }),
      now,
    );

    expect(response.plan).toBeNull();
    expect(response.percentage).toBe(25);
  });
});
