import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { PeriodQueryDto } from '@modules/financial-periods/dto/period-query.dto';
import { CreateInstallmentPlanDto } from './dto/create-installment-plan.dto';
import {
  ListInstallmentPlansQueryDto,
  RegisterPendingInstallmentsDto,
  SettleInstallmentPlanDto,
} from './dto/installment-plan-query.dto';
import { UpdateInstallmentPlanDto } from './dto/update-installment-plan.dto';
import type {
  IInstallmentPlanDetail,
  IInstallmentPlanResponse,
  IPendingInstallment,
  IRegisteredInstallment,
} from './interfaces/installment-plan-response.interface';
import { InstallmentPlansService } from './installment-plans.service';

@UseGuards(ApiKeyGuard)
@Controller('installment-plans')
export class InstallmentPlansController {
  constructor(private readonly plans: InstallmentPlansService) {}

  @Get()
  findAll(
    @Query() query: ListInstallmentPlansQueryDto,
  ): Promise<IInstallmentPlanResponse[]> {
    return this.plans.findAll(query);
  }

  /** Antes de `:id`: "pending" no es un id. */
  @Get('pending')
  findPending(@Query() query: PeriodQueryDto): Promise<IPendingInstallment[]> {
    return this.plans.findPending(query.periodId);
  }

  @Post('pending/register')
  @HttpCode(HttpStatus.OK)
  registerPending(
    @Body() dto: RegisterPendingInstallmentsDto,
  ): Promise<IRegisteredInstallment[]> {
    return this.plans.registerPending(dto.periodId);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<IInstallmentPlanDetail> {
    return this.plans.findOne(id);
  }

  @Post()
  create(
    @Body() dto: CreateInstallmentPlanDto,
  ): Promise<IInstallmentPlanDetail> {
    return this.plans.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInstallmentPlanDto,
  ): Promise<IInstallmentPlanDetail> {
    return this.plans.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.plans.remove(id);
  }

  @Post(':id/installments/:number')
  @HttpCode(HttpStatus.OK)
  recognize(
    @Param('id') id: string,
    @Param('number', ParseIntPipe) number: number,
  ): Promise<IInstallmentPlanDetail> {
    return this.plans.recognize(id, number);
  }

  @Delete(':id/installments/:number')
  unrecognize(
    @Param('id') id: string,
    @Param('number', ParseIntPipe) number: number,
  ): Promise<IInstallmentPlanDetail> {
    return this.plans.unrecognize(id, number);
  }

  @Post(':id/settle')
  @HttpCode(HttpStatus.OK)
  settle(
    @Param('id') id: string,
    @Body() dto: SettleInstallmentPlanDto,
  ): Promise<IInstallmentPlanDetail> {
    return this.plans.settle(id, dto);
  }

  @Delete(':id/settle')
  unsettle(@Param('id') id: string): Promise<IInstallmentPlanDetail> {
    return this.plans.unsettle(id);
  }
}
