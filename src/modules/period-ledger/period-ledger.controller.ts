import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import {
  PeriodParamDto,
  PeriodQueryDto,
} from '@modules/financial-periods/dto/period-query.dto';
import type { IPeriodLedgerResponse } from './interfaces/period-ledger-response.interface';
import { PeriodLedgerQueryService } from './period-ledger-query.service';

@UseGuards(ApiKeyGuard)
@Controller('period-ledger')
export class PeriodLedgerController {
  constructor(private readonly ledgerQuery: PeriodLedgerQueryService) {}

  @Get()
  findByPeriod(@Query() query: PeriodQueryDto): Promise<IPeriodLedgerResponse> {
    return this.ledgerQuery.findByPeriod(query.periodId);
  }

  /** Recalcula en cascada desde `:periodId`; útil para reconstruir el historial. */
  @Post(':periodId/recalculate')
  @HttpCode(HttpStatus.OK)
  recalculate(
    @Param() params: PeriodParamDto,
  ): Promise<IPeriodLedgerResponse[]> {
    return this.ledgerQuery.recalculateFrom(params.periodId);
  }
}
