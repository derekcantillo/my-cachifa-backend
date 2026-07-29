import { GoalStatus, PlanPhase } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

export class CreateGoalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  targetAmount!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  currentAmount?: number;

  @IsDateString()
  targetDate!: string;

  @IsEnum(PlanPhase)
  phase!: PlanPhase;

  /** Default `ACTIVE` si se omite. */
  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;
}
