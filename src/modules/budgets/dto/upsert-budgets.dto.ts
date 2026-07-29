import { Type } from 'class-transformer';
import { Category } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';

export class BudgetItemDto {
  @IsEnum(Category)
  category!: Category;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  limitAmount!: number;
}

export class UpsertBudgetsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(Object.keys(Category).length)
  @ValidateNested({ each: true })
  @Type(() => BudgetItemDto)
  items!: BudgetItemDto[];
}
