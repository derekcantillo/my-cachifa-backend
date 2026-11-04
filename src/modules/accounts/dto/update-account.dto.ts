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
  ValidateIf,
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

/** Se valida si llega, también `null`: estos campos no se pueden borrar. */
const isPresent = (_dto: object, value: unknown) => value !== undefined;

/**
 * Todos opcionales. `institutionId`, `cardLast4` y los campos de tarjeta aceptan
 * `null` para desligar la entidad o borrar el valor. Los campos de tarjeta solo
 * valen en una `CREDIT_CARD`. El saldo inicial sigue en
 * `PATCH /accounts/:id/initial-balance`, y el ancla al extracto en
 * `POST /accounts/:id/statement-balance`.
 */
export class UpdateAccountDto {
  @ValidateIf(isPresent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  /** Pasar a o desde `CREDIT_CARD` con movimientos se rechaza en el servicio. */
  @ValidateIf(isPresent)
  @IsEnum(AccountType)
  @IsNotIn(RETIRED_ACCOUNT_TYPES, { message: RETIRED_ACCOUNT_TYPE_MESSAGE })
  type?: AccountType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  institutionId?: string | null;

  @ValidateIf(isPresent)
  @Transform(rawBodyValue)
  @IsBoolean()
  hasDebitCard?: boolean;

  @IsOptional()
  @IsString()
  @Matches(CARD_LAST4_REGEX, { message: CARD_LAST4_MESSAGE })
  cardLast4?: string | null;

  /** Solo `CREDIT_CARD`. Configurar una tarjeta que ya tiene saldo va por `statement-balance`. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MAX_CREDIT_LIMIT)
  creditLimit?: number | null;

  /** 1-31; 31 = último día del mes. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  statementDay?: number | null;

  /** 1-31, del mes siguiente al corte. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  paymentDueDay?: number | null;

  /** % mensual (2.1155 = 2,1155 %). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(MAX_MONTHLY_RATE)
  defaultMonthlyRate?: number | null;
}
