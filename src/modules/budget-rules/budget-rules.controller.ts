import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { BudgetRulesService } from './budget-rules.service';
import { UpsertBudgetRulesDto } from './dto/upsert-budget-rules.dto';
import type {
  IBudgetRuleResponse,
  IUpsertBudgetRulesResponse,
} from './interfaces/budget-rule-response.interface';

@UseGuards(ApiKeyGuard)
@Controller('budget-rules')
export class BudgetRulesController {
  constructor(private readonly budgetRulesService: BudgetRulesService) {}

  @Get()
  findAll(): Promise<IBudgetRuleResponse[]> {
    return this.budgetRulesService.findAll();
  }

  @Put()
  upsertMany(
    @Body() dto: UpsertBudgetRulesDto,
  ): Promise<IUpsertBudgetRulesResponse> {
    return this.budgetRulesService.upsertMany(dto);
  }
}
