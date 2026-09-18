import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { FinancialPeriodService } from './financial-period.service';
import type { IFinancialPeriodResponse } from './interfaces/financial-period-response.interface';

@UseGuards(ApiKeyGuard)
@Controller('financial-periods')
export class FinancialPeriodsController {
  constructor(private readonly financialPeriods: FinancialPeriodService) {}

  /** Todos los períodos del usuario, el más reciente primero. */
  @Get()
  findAll(): Promise<IFinancialPeriodResponse[]> {
    return this.financialPeriods.findAll();
  }

  // Declarado antes que cualquier `:id` futuro para que "current" no se lea como id.
  @Get('current')
  findCurrent(): Promise<IFinancialPeriodResponse> {
    return this.financialPeriods.findCurrent();
  }
}
