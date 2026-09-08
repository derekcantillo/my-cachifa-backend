import { IsOptional, IsBoolean } from 'class-validator';

export class ListAlertsQueryDto {
  /** Si se omite o es `false`, devuelve todas (últimas 50). */
  @IsOptional()
  @IsBoolean()
  unreadOnly?: boolean;
}
