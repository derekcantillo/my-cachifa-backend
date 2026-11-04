import { Category, TransactionType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNotIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { MONTH_YEAR_MESSAGE, MONTH_YEAR_REGEX } from '@common/utils/month.util';
import {
  LOAN_MOVEMENT_TYPE_MESSAGE,
  LOAN_MOVEMENT_TYPES,
} from '../loan-movement-types';

export class CreateTransactionDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsEnum(TransactionType)
  @IsNotIn(LOAN_MOVEMENT_TYPES, { message: LOAN_MOVEMENT_TYPE_MESSAGE })
  type!: TransactionType;

  /**
   * Obligatoria salvo en una `TRANSFER`, que no tiene categoría: si llega se
   * ignora y se guarda `OTHER`.
   */
  @ValidateIf(
    (dto: CreateTransactionDto) =>
      dto.type !== TransactionType.TRANSFER || dto.category !== undefined,
  )
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
   * Cuenta destino de una `TRANSFER` (`accountId` es el origen). Obligatoria
   * en ese tipo y rechazada en cualquier otro.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  toAccountId?: string | null;

  /** Enlaza esta transacción a un gasto fijo recurrente. Debe ser del usuario y de la misma categoría. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  recurringExpenseId?: string;

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
