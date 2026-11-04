import type { FinancialInstitution } from '@prisma/client';

export interface IInstitutionResponse {
  id: string;
  name: string;
  /** Productos (`Account`) ligados a la entidad. */
  accountCount: number;
  createdAt: string;
  updatedAt: string;
}

export function toInstitutionResponse(
  institution: FinancialInstitution,
  accountCount: number,
): IInstitutionResponse {
  return {
    id: institution.id,
    name: institution.name,
    accountCount,
    createdAt: institution.createdAt.toISOString(),
    updatedAt: institution.updatedAt.toISOString(),
  };
}
