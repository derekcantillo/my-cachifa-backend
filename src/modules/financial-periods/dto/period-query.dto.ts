import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PeriodQueryDto {
  /** `FinancialPeriod.id`. Si se omite se usa el período actual. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  periodId?: string;
}

export class PeriodParamDto {
  @IsString()
  @IsNotEmpty()
  periodId!: string;
}
