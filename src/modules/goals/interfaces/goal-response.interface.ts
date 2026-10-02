import type {
  Goal,
  GoalContribution,
  GoalStatus,
  PlanPhase,
} from '@prisma/client';
import { toPercentage } from '@common/utils/percentage.util';
import { calculateGoalPlan, type IGoalPlan } from '../lib/goal-plan';

export type GoalWithContributions = Goal & {
  contributions: GoalContribution[];
};

/**
 * Los montos viajan como `number` en JSON; en base de datos siguen siendo
 * `Decimal(12,2)`.
 */
export interface IGoalContributionResponse {
  id: string;
  amount: number;
  note: string | null;
  contributedAt: string;
  createdAt: string;
}

export interface IGoalResponse {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  /** `currentAmount / targetAmount * 100`, a un decimal. */
  percentage: number;
  targetDate: string;
  phase: PlanPhase;
  status: GoalStatus;
  /**
   * Aporte mensual que exige la meta, calculado al leer por
   * `calculateGoalPlan`. `null` si la meta no está `ACTIVE`.
   */
  plan: IGoalPlan | null;
  contributions: IGoalContributionResponse[];
  createdAt: string;
  updatedAt: string;
}

function toContributionResponse(
  contribution: GoalContribution,
): IGoalContributionResponse {
  return {
    id: contribution.id,
    amount: contribution.amount.toNumber(),
    note: contribution.note,
    contributedAt: contribution.contributedAt.toISOString(),
    createdAt: contribution.createdAt.toISOString(),
  };
}

export function toGoalResponse(
  goal: GoalWithContributions,
  now: Date = new Date(),
): IGoalResponse {
  return {
    id: goal.id,
    name: goal.name,
    targetAmount: goal.targetAmount.toNumber(),
    currentAmount: goal.currentAmount.toNumber(),
    percentage: toPercentage(goal.currentAmount, goal.targetAmount),
    targetDate: goal.targetDate.toISOString(),
    phase: goal.phase,
    status: goal.status,
    plan: calculateGoalPlan(goal, now),
    contributions: goal.contributions.map(toContributionResponse),
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}
