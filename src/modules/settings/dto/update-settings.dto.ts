import { IsNumber, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  targetSavingsPercentage!: number;
}
