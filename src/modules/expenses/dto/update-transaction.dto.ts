import { Category, TransactionType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { MONTH_YEAR_MESSAGE, MONTH_YEAR_REGEX } from '@common/utils/month.util';

/**
 * Todos los campos son opcionales. `accountId` acepta `null` de forma
 * explícita para desligar la transacción de una cuenta.
 */
export class UpdateTransactionDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @IsOptional()
  @IsEnum(Category)
  category?: Category;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  accountId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsDateString()
  transactionDate?: string;

  /**
   * `YYYY-MM` que este ingreso cubre. Solo el formato se valida aquí — si el
   * resultado de la edición (tipo + categoría, ya mezclados con lo
   * existente) es INCOME + SALARY, el servicio exige que quede un valor;
   * para cualquier otro caso lo recalcula e ignora lo que venga aquí.
   */
  @IsOptional()
  @Matches(MONTH_YEAR_REGEX, { message: MONTH_YEAR_MESSAGE })
  budgetPeriod?: string;
}
