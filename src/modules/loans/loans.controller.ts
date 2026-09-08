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
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { CreateLoanRepaymentDto } from './dto/create-loan-repayment.dto';
import { CreateLoanDto } from './dto/create-loan.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';
import type {
  ILoanDetailResponse,
  ILoanResponse,
} from './interfaces/loan-response.interface';
import { LoansService } from './loans.service';

@UseGuards(ApiKeyGuard)
@Controller('loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  @Get()
  findAll(): Promise<ILoanResponse[]> {
    return this.loansService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<ILoanDetailResponse> {
    return this.loansService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateLoanDto): Promise<ILoanResponse> {
    return this.loansService.create(dto);
  }

  @Post(':id/repayments')
  addRepayment(
    @Param('id') id: string,
    @Body() dto: CreateLoanRepaymentDto,
  ): Promise<ILoanDetailResponse> {
    return this.loansService.addRepayment(id, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLoanDto,
  ): Promise<ILoanResponse> {
    return this.loansService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.loansService.remove(id);
  }
}
