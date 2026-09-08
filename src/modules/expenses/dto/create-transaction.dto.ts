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
  ValidateIf,
} from 'class-validator';
import { MONTH_YEAR_MESSAGE, MONTH_YEAR_REGEX } from '@common/utils/month.util';

export class CreateTransactionDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsEnum(TransactionType)
  type!: TransactionType;

  @IsEnum(Category)
  category!: Category;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  accountId?: string | null;

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
   * `YYYY-MM` que este ingreso cubre. Requerido solo para INCOME + SALARY
   * (el desfase de nómina); para cualquier otro caso se calcula del lado del
   * servidor a partir de `transactionDate` y cualquier valor enviado aquí se
   * ignora.
   */
  @ValidateIf(
    (dto: CreateTransactionDto) =>
      dto.type === TransactionType.INCOME && dto.category === Category.SALARY,
  )
  @IsNotEmpty({ message: 'budgetPeriod is required for SALARY income' })
  @Matches(MONTH_YEAR_REGEX, { message: MONTH_YEAR_MESSAGE })
  budgetPeriod?: string;
}
