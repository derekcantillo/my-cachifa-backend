import type { BudgetRule, Category } from '@prisma/client';

/** El porcentaje viaja como `number` en JSON; en base de datos es `Decimal(5,2)`. */
export interface IBudgetRuleResponse {
  id: string;
  category: Category;
  targetPercentage: number;
  createdAt: string;
  updatedAt: string;
}

export interface IUpsertBudgetRulesResponse {
  rules: IBudgetRuleResponse[];
  totalPercentage: number;
  /** No nulo cuando `totalPercentage` supera 100 — las reglas no tienen que sumar exacto. */
  warning: string | null;
}

export function toBudgetRuleResponse(rule: BudgetRule): IBudgetRuleResponse {
  return {
    id: rule.id,
    category: rule.category,
    targetPercentage: rule.targetPercentage.toNumber(),
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}
