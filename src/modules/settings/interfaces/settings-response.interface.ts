import type { User } from '@prisma/client';

export interface ISettingsResponse {
  targetSavingsPercentage: number;
}

export function toSettingsResponse(user: User): ISettingsResponse {
  return {
    targetSavingsPercentage: user.targetSavingsPercentage.toNumber(),
  };
}
