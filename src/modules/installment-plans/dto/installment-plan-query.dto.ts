import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import {
  CALENDAR_DATE_REGEX,
  calendarDateMessage,
} from './create-installment-plan.dto';

export const PLAN_STATUS_VIEWS = ['ACTIVE', 'FINISHED', 'SETTLED'] as const;

export class ListInstallmentPlansQueryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  accountId?: string;

  /** Estado calculado: `FINISHED` = todas las cuotas facturadas y ninguna pendiente. */
  @IsOptional()
  @IsIn(PLAN_STATUS_VIEWS)
  status?: (typeof PLAN_STATUS_VIEWS)[number];
}

export class RegisterPendingInstallmentsDto {
  /** Período cuyas cuotas pendientes se registran; por defecto el actual. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  periodId?: string;
}

export class SettleInstallmentPlanDto {
  /** Día en que se liquidó (por defecto hoy, en Bogotá). */
  @IsOptional()
  @Matches(CALENDAR_DATE_REGEX, { message: calendarDateMessage('settledAt') })
  settledAt?: string;
}
