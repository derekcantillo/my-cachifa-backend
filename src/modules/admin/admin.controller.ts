import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { FinancialPeriodService } from '@modules/financial-periods/financial-period.service';
import type { IMigratePeriodsResponse } from '@modules/financial-periods/interfaces/migrate-periods-response.interface';

@UseGuards(ApiKeyGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly financialPeriods: FinancialPeriodService) {}

  /**
   * Migración única al modelo de períodos financieros. Idempotente: se puede
   * volver a correr sin efectos si nada cambió.
   */
  @Post('migrate-periods')
  @HttpCode(HttpStatus.OK)
  migratePeriods(): Promise<IMigratePeriodsResponse> {
    return this.financialPeriods.migrateAll();
  }
}
