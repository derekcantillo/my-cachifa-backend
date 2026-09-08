import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { CreateRecurringExpenseDto } from './dto/create-recurring-expense.dto';
import { PendingQueryDto } from './dto/pending-query.dto';
import { UpdateRecurringExpenseDto } from './dto/update-recurring-expense.dto';
import type { IRecurringExpenseResponse } from './interfaces/recurring-expense-response.interface';
import { RecurringExpensesService } from './recurring-expenses.service';

@UseGuards(ApiKeyGuard)
@Controller('recurring-expenses')
export class RecurringExpensesController {
  constructor(
    private readonly recurringExpensesService: RecurringExpensesService,
  ) {}

  @Get()
  findAll(): Promise<IRecurringExpenseResponse[]> {
    return this.recurringExpensesService.findAll();
  }

  // Declarado antes que cualquier `:id` para que "pending" no se lea como id.
  @Get('pending')
  findPending(
    @Query() query: PendingQueryDto,
  ): Promise<IRecurringExpenseResponse[]> {
    return this.recurringExpensesService.findPending(query.month);
  }

  @Post()
  create(
    @Body() dto: CreateRecurringExpenseDto,
  ): Promise<IRecurringExpenseResponse> {
    return this.recurringExpensesService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRecurringExpenseDto,
  ): Promise<IRecurringExpenseResponse> {
    return this.recurringExpensesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.recurringExpensesService.remove(id);
  }
}
