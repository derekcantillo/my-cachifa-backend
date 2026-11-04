import {
  IsNumber,
  IsOptional,
  IsPositive,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { MAX_CREDIT_LIMIT } from '../account-types';

const CALENDAR_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const calendarDateMessage = (field: string) =>
  `${field} must be a date as YYYY-MM-DD`;

/**
 * Ancla el saldo de una cuenta a un extracto (B.4) o al saldo del banco (B.5),
 * "al cierre" de ese día en hora Bogotá.
 * - `CREDIT_CARD`: `cutDate` + `totalDebt` (lo que se debe, ≥ 0), y opcionalmente
 *   `creditLimit` para configurarla en la misma llamada.
 * - Cualquier otra cuenta: `date` + `balance` (puede ser negativo).
 * Qué campos van con qué tipo se valida en el servicio.
 */
export class StatementBalanceDto {
  @IsOptional()
  @Matches(CALENDAR_DATE_REGEX, { message: calendarDateMessage('cutDate') })
  cutDate?: string;

  /** Pago total del extracto. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_CREDIT_LIMIT)
  totalDebt?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MAX_CREDIT_LIMIT)
  creditLimit?: number;

  @IsOptional()
  @Matches(CALENDAR_DATE_REGEX, { message: calendarDateMessage('date') })
  date?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-MAX_CREDIT_LIMIT)
  @Max(MAX_CREDIT_LIMIT)
  balance?: number;
}
