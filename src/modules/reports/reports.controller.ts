import { Controller, Get, Query } from '@nestjs/common';
import { QueryMonthDto } from './dto/query-month.dto';
import type {
  IDistributionItem,
  IReportSummary,
  ISavingsProjection,
} from './interfaces/report-response.interface';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('summary')
  getSummary(@Query() query: QueryMonthDto): Promise<IReportSummary> {
    return this.reportsService.getSummary(query.month);
  }

  @Get('distribution')
  getDistribution(@Query() query: QueryMonthDto): Promise<IDistributionItem[]> {
    return this.reportsService.getDistribution(query.month);
  }

  @Get('savings-projection')
  getSavingsProjection(): Promise<ISavingsProjection> {
    return this.reportsService.getSavingsProjection();
  }
}
