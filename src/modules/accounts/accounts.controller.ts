import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { AccountsService } from './accounts.service';
import { BalanceAdjustmentsService } from './balance-adjustments.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { StatementBalanceDto } from './dto/statement-balance.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { UpdateInitialBalanceDto } from './dto/update-initial-balance.dto';
import type { IAccountResponse } from './interfaces/account-response.interface';
import type {
  IBalanceAdjustmentResponse,
  IBalanceAdjustmentResult,
} from './interfaces/balance-adjustment-response.interface';

@UseGuards(ApiKeyGuard)
@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly balanceAdjustments: BalanceAdjustmentsService,
  ) {}

  @Get()
  findAll(): Promise<IAccountResponse[]> {
    return this.accountsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateAccountDto): Promise<IAccountResponse> {
    return this.accountsService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ): Promise<IAccountResponse> {
    return this.accountsService.update(id, dto);
  }

  @Patch(':id/initial-balance')
  updateInitialBalance(
    @Param('id') id: string,
    @Body() dto: UpdateInitialBalanceDto,
  ): Promise<IAccountResponse> {
    return this.balanceAdjustments.updateInitialBalance(id, dto);
  }

  /** Ancla el saldo a un extracto de tarjeta o al saldo del banco a una fecha. */
  @Post(':id/statement-balance')
  @HttpCode(HttpStatus.OK)
  anchorToStatement(
    @Param('id') id: string,
    @Body() dto: StatementBalanceDto,
  ): Promise<IBalanceAdjustmentResult> {
    return this.balanceAdjustments.anchorToStatement(id, dto);
  }

  @Get(':id/balance-adjustments')
  findAdjustments(
    @Param('id') id: string,
  ): Promise<IBalanceAdjustmentResponse[]> {
    return this.balanceAdjustments.findAll(id);
  }

  @Post(':id/balance-adjustments/:adjustmentId/revert')
  @HttpCode(HttpStatus.OK)
  revertAdjustment(
    @Param('id') id: string,
    @Param('adjustmentId') adjustmentId: string,
  ): Promise<IBalanceAdjustmentResult> {
    return this.balanceAdjustments.revert(id, adjustmentId);
  }
}
