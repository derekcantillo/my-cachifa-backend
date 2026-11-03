import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Todos los campos son opcionales. `amount`, `loanDate` y `accountId` también
 * corrigen la transacción `LOAN_GIVEN` del préstamo; `accountId` acepta `null`
 * para desligarlo de una cuenta. Los abonos no se tocan.
 */
export class UpdateLoanDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  borrowerName?: string;

  /** No puede quedar por debajo de lo ya abonado. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsDateString()
  loanDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  accountId?: string | null;
}
