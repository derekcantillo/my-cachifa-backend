import { Type } from 'class-transformer';
import { Category } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNumber,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class BudgetRuleItemDto {
  @IsEnum(Category)
  category!: Category;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  targetPercentage!: number;
}

export class UpsertBudgetRulesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(Object.keys(Category).length)
  @ValidateNested({ each: true })
  @Type(() => BudgetRuleItemDto)
  rules!: BudgetRuleItemDto[];
}
