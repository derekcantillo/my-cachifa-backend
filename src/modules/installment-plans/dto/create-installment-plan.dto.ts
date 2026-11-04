import { Category, InstallmentPlanKind } from '@prisma/client';
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
} from 'class-validator';
import {
  MAX_CREDIT_LIMIT,
  MAX_MONTHLY_RATE,
  rawBodyValue,
} from '@modules/accounts/account-types';

export const CALENDAR_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const calendarDateMessage = (field: string) =>
  `${field} must be a date as YYYY-MM-DD`;

export const MIN_INSTALLMENTS = 2;
export const MAX_INSTALLMENTS = 48;

/**
 * - `PURCHASE`: compra nueva con la tarjeta (después de su ancla); crea el
 *   `FINANCED_PURCHASE` por el monto completo.
 * - `LEGACY`: compra a cuotas que ya estaba en el extracto; sin transacción.
 * - `REFINANCE`: ampliación de plazo; sin transacción.
 */
export class CreateInstallmentPlanDto {
  /** La `CREDIT_CARD`. */
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsEnum(InstallmentPlanKind)
  kind!: InstallmentPlanKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  description!: string;

  /** Lo que se compró; también la categoría de cada cuota. Obligatoria si las cuotas cuentan como gasto. */
  @IsOptional()
  @IsEnum(Category)
  category?: Category;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MAX_CREDIT_LIMIT)
  principal!: number;

  @IsInt()
  @Min(MIN_INSTALLMENTS)
  @Max(MAX_INSTALLMENTS)
  installmentCount!: number;

  /** % mensual del plan; por defecto, el `defaultMonthlyRate` de la tarjeta. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(MAX_MONTHLY_RATE)
  monthlyRate?: number;

  /** Día de la compra o de la ampliación. */
  @Matches(CALENDAR_DATE_REGEX, { message: calendarDateMessage('startDate') })
  startDate!: string;

  /** Corte que factura la cuota 1 (vale el mes). Por defecto, el primer corte desde `startDate`. */
  @IsOptional()
  @Matches(CALENDAR_DATE_REGEX, {
    message: calendarDateMessage('firstStatementDate'),
  })
  firstStatementDate?: string;

  /** Cuotas ya pagadas antes de registrar el plan: 8 si el extracto dice "9/24". */
  @IsOptional()
  @IsInt()
  @Min(0)
  billedBeforeTracking?: number;

  /** Por defecto `true` en `PURCHASE` y `LEGACY`, `false` en `REFINANCE`. */
  @IsOptional()
  @Transform(rawBodyValue)
  @IsBoolean()
  recognizeInstallments?: boolean;
}
