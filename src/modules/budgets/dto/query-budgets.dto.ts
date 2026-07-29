import { IsOptional, Matches } from 'class-validator';
import { MONTH_YEAR_MESSAGE, MONTH_YEAR_REGEX } from '@common/utils/month.util';

export class QueryBudgetsDto {
  /** `YYYY-MM`. Si se omite se usa el mes en curso. */
  @IsOptional()
  @Matches(MONTH_YEAR_REGEX, { message: MONTH_YEAR_MESSAGE })
  month?: string;
}
