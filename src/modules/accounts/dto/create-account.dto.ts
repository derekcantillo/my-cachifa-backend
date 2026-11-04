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
} from 'class-validator';
import {
  CARD_LAST4_MESSAGE,
  CARD_LAST4_REGEX,
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
}
