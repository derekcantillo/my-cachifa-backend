import { IsDateString, IsNumber } from 'class-validator';

export class UpdateInitialBalanceDto {
  /** Puede ser negativo — una tarjeta de crédito parte en deuda. */
  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  @IsDateString()
  date!: string;
}
