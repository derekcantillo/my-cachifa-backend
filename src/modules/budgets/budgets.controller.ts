import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import {
  PeriodParamDto,
  PeriodQueryDto,
} from '@modules/financial-periods/dto/period-query.dto';
import { BudgetsService } from './budgets.service';
import { UpsertBudgetsDto } from './dto/upsert-budgets.dto';
import type { IBudgetResponse } from './interfaces/budget-response.interface';

@UseGuards(ApiKeyGuard)
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get()
  findAll(@Query() query: PeriodQueryDto): Promise<IBudgetResponse[]> {
    return this.budgetsService.findAll(query.periodId);
  }

  @Put()
  upsertMany(
    @Query() query: PeriodQueryDto,
    @Body() dto: UpsertBudgetsDto,
  ): Promise<IBudgetResponse[]> {
    return this.budgetsService.upsertMany(dto, query.periodId);
  }

  @Post(':periodId/reset')
  @HttpCode(HttpStatus.OK)
  resetSpent(@Param() params: PeriodParamDto): Promise<IBudgetResponse[]> {
    return this.budgetsService.resetSpent(params.periodId);
  }

  @Post(':periodId/recalculate')
  @HttpCode(HttpStatus.OK)
  recalculate(@Param() params: PeriodParamDto): Promise<IBudgetResponse[]> {
    return this.budgetsService.recalculate(params.periodId);
  }
}
