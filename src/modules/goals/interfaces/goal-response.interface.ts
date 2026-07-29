import type {
  Goal,
  GoalContribution,
  GoalStatus,
  PlanPhase,
} from '@prisma/client';
import { toPercentage } from '@common/utils/percentage.util';

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

export function toGoalResponse(goal: GoalWithContributions): IGoalResponse {
  return {
    id: goal.id,
    name: goal.name,
    targetAmount: goal.targetAmount.toNumber(),
    currentAmount: goal.currentAmount.toNumber(),
    percentage: toPercentage(goal.currentAmount, goal.targetAmount),
    targetDate: goal.targetDate.toISOString(),
    phase: goal.phase,
    status: goal.status,
    contributions: goal.contributions.map(toContributionResponse),
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}
