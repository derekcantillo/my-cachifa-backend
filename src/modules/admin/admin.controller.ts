import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { AdminService } from './admin.service';
import type { IMigratePeriodsResponse } from './interfaces/migrate-periods-response.interface';

@UseGuards(ApiKeyGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * Reconstruye períodos, `periodId` de las transacciones, ledger y
   * presupuestos. Idempotente: se puede volver a correr sin efectos si nada
   * cambió.
   */
  @Post('migrate-periods')
  @HttpCode(HttpStatus.OK)
  migratePeriods(): Promise<IMigratePeriodsResponse> {
    return this.adminService.migratePeriods();
  }
}
