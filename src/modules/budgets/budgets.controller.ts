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
} from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { MonthParamDto } from './dto/month-param.dto';
import { QueryBudgetsDto } from './dto/query-budgets.dto';
import { UpsertBudgetsDto } from './dto/upsert-budgets.dto';
import type { IBudgetResponse } from './interfaces/budget-response.interface';

@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get()
  findAll(@Query() query: QueryBudgetsDto): Promise<IBudgetResponse[]> {
    return this.budgetsService.findAll(query.month);
  }

  @Put()
  upsertMany(
    @Query() query: QueryBudgetsDto,
    @Body() dto: UpsertBudgetsDto,
  ): Promise<IBudgetResponse[]> {
    return this.budgetsService.upsertMany(dto, query.month);
  }

  @Post(':month/reset')
  @HttpCode(HttpStatus.OK)
  resetSpent(@Param() params: MonthParamDto): Promise<IBudgetResponse[]> {
    return this.budgetsService.resetSpent(params.month);
  }
}
