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
import { MonthParamDto } from '@modules/budgets/dto/month-param.dto';
import { QueryMonthDto } from '@modules/reports/dto/query-month.dto';
import type { IMonthlyLedgerResponse } from './interfaces/monthly-ledger-response.interface';
import { MonthlyLedgerQueryService } from './monthly-ledger-query.service';

@UseGuards(ApiKeyGuard)
@Controller('monthly-ledger')
export class MonthlyLedgerController {
  constructor(private readonly ledgerQuery: MonthlyLedgerQueryService) {}

  @Get()
  findByMonth(@Query() query: QueryMonthDto): Promise<IMonthlyLedgerResponse> {
    return this.ledgerQuery.findByMonth(query.month);
  }

  /** Recalcula en cascada desde `:month`; útil para reconstruir el historial previo a este bloque. */
  @Post(':month/recalculate')
  @HttpCode(HttpStatus.OK)
  recalculate(
    @Param() params: MonthParamDto,
  ): Promise<IMonthlyLedgerResponse[]> {
    return this.ledgerQuery.recalculateFrom(params.month);
  }
}
