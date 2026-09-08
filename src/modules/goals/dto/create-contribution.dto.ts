import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateContributionDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;

  /** Para registrar ahorro acumulado antes de usar la app; por defecto, ahora. */
  @IsOptional()
  @IsDateString()
  contributedAt?: string;
}
