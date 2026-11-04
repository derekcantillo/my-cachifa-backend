import { AccountType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNotIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CARD_LAST4_MESSAGE,
  CARD_LAST4_REGEX,
  MAX_CREDIT_LIMIT,
  MAX_MONTHLY_RATE,
  RETIRED_ACCOUNT_TYPE_MESSAGE,
  RETIRED_ACCOUNT_TYPES,
  rawBodyValue,
} from '../account-types';

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsEnum(AccountType)
  @IsNotIn(RETIRED_ACCOUNT_TYPES, { message: RETIRED_ACCOUNT_TYPE_MESSAGE })
  type!: AccountType;

  /** Entidad del producto; sin ella, la cuenta queda en "Sin entidad". */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  institutionId?: string;

  @IsOptional()
  @Transform(rawBodyValue)
  @IsBoolean()
  hasDebitCard?: boolean;

  @IsOptional()
  @IsString()
  @Matches(CARD_LAST4_REGEX, { message: CARD_LAST4_MESSAGE })
  cardLast4?: string;

  /** Solo `CREDIT_CARD`. Configurar una tarjeta que ya tiene saldo va por `statement-balance`. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MAX_CREDIT_LIMIT)
  creditLimit?: number;

  /** 1-31; 31 = último día del mes. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  statementDay?: number;

  /** 1-31, del mes siguiente al corte. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  paymentDueDay?: number;

  /** % mensual (2.1155 = 2,1155 %). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(MAX_MONTHLY_RATE)
  defaultMonthlyRate?: number;
}
