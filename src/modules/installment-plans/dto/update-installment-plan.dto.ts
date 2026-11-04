import { Category } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
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
  MAX_CREDIT_LIMIT,
  MAX_MONTHLY_RATE,
  rawBodyValue,
} from '@modules/accounts/account-types';
import {
  CALENDAR_DATE_REGEX,
  calendarDateMessage,
  MAX_INSTALLMENTS,
  MIN_INSTALLMENTS,
} from './create-installment-plan.dto';

/** Se valida si llega, también `null`: estos campos no se pueden borrar. */
const isPresent = (_dto: object, value: unknown) => value !== undefined;

/**
 * Con cuotas reconocidas solo cambian `description`, `category` y
 * `monthlyRate`; el resto exige deshacerlas antes (D.6). `accountId` y `kind`
 * no se editan: se borra el plan y se crea otro.
 */
export class UpdateInstallmentPlanDto {
  @ValidateIf(isPresent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  description?: string;

  /** `null` la borra (solo si las cuotas no cuentan como gasto). */
  @IsOptional()
  @IsEnum(Category)
  category?: Category | null;

  @ValidateIf(isPresent)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(MAX_MONTHLY_RATE)
  monthlyRate?: number;

  @ValidateIf(isPresent)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MAX_CREDIT_LIMIT)
  principal?: number;

  @ValidateIf(isPresent)
  @IsInt()
  @Min(MIN_INSTALLMENTS)
  @Max(MAX_INSTALLMENTS)
  installmentCount?: number;

  @ValidateIf(isPresent)
  @Matches(CALENDAR_DATE_REGEX, { message: calendarDateMessage('startDate') })
  startDate?: string;

  @ValidateIf(isPresent)
  @Matches(CALENDAR_DATE_REGEX, {
    message: calendarDateMessage('firstStatementDate'),
  })
  firstStatementDate?: string;

  @ValidateIf(isPresent)
  @IsInt()
  @Min(0)
  billedBeforeTracking?: number;

  @ValidateIf(isPresent)
  @Transform(rawBodyValue)
  @IsBoolean()
  recognizeInstallments?: boolean;
}
