import { Category } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateRecurringExpenseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsEnum(Category)
  category!: Category;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  estimatedAmount!: number;

  /** Si el monto real varía mes a mes o es siempre igual. Default `false`. */
  @IsOptional()
  @IsBoolean()
  isAmountFixed?: boolean;

  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth!: number;

  /** Default `true` si se omite. */
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
