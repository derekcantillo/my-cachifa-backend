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
 * Todos los campos son opcionales. `accountId` y `recurringExpenseId` aceptan
 * `null` de forma explícita para desligar la transacción de una cuenta o de un
 * gasto fijo.
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

  /**
   * Cruza la transacción con un gasto fijo, o la descruza con `null`. Si se
   * omite, el vínculo no cambia. Mismas reglas que al crear: el gasto fijo
   * debe ser del usuario y de la misma categoría que la transacción.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  recurringExpenseId?: string | null;

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
   * @deprecated Se acepta para no romper clientes que aún lo envían, pero se
   * ignora: el período de un salario lo define su `transactionDate`.
   */
  @IsOptional()
  @Matches(MONTH_YEAR_REGEX, { message: MONTH_YEAR_MESSAGE })
  budgetPeriod?: string;
}
