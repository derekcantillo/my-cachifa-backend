import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { PeriodQueryDto } from '@modules/financial-periods/dto/period-query.dto';
import type {
  IDistributionItem,
  IReportSummary,
  ISavingsProjection,
} from './interfaces/report-response.interface';
import { ReportsService } from './reports.service';

@UseGuards(ApiKeyGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('summary')
  getSummary(@Query() query: PeriodQueryDto): Promise<IReportSummary> {
    return this.reportsService.getSummary(query.periodId);
  }

  @Get('distribution')
  getDistribution(
    @Query() query: PeriodQueryDto,
  ): Promise<IDistributionItem[]> {
    return this.reportsService.getDistribution(query.periodId);
  }

  @Get('savings-projection')
  getSavingsProjection(): Promise<ISavingsProjection> {
    return this.reportsService.getSavingsProjection();
  }
}
