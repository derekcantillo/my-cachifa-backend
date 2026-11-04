import { AccountType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNotIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  CARD_LAST4_MESSAGE,
  CARD_LAST4_REGEX,
  RETIRED_ACCOUNT_TYPE_MESSAGE,
  RETIRED_ACCOUNT_TYPES,
  rawBodyValue,
} from '../account-types';

/** Se valida si llega, también `null`: estos campos no se pueden borrar. */
const isPresent = (_dto: object, value: unknown) => value !== undefined;

/**
 * Todos opcionales. `institutionId` y `cardLast4` aceptan `null` para desligar
 * la entidad o borrar los dígitos. El saldo inicial sigue en
 * `PATCH /accounts/:id/initial-balance`.
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
}
