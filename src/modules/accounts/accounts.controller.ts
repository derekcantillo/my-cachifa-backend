import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateInitialBalanceDto } from './dto/update-initial-balance.dto';
import type { IAccountResponse } from './interfaces/account-response.interface';

@UseGuards(ApiKeyGuard)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  findAll(): Promise<IAccountResponse[]> {
    return this.accountsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateAccountDto): Promise<IAccountResponse> {
    return this.accountsService.create(dto);
  }

  @Patch(':id/initial-balance')
  updateInitialBalance(
    @Param('id') id: string,
    @Body() dto: UpdateInitialBalanceDto,
  ): Promise<IAccountResponse> {
    return this.accountsService.updateInitialBalance(id, dto);
  }
}
