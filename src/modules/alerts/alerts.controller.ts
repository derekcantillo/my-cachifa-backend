import {
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { AlertsService } from './alerts.service';
import { ListAlertsQueryDto } from './dto/list-alerts-query.dto';
import type { IAlertResponse } from './interfaces/alert-response.interface';

@UseGuards(ApiKeyGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  findAll(@Query() query: ListAlertsQueryDto): Promise<IAlertResponse[]> {
    return this.alertsService.findAll(query.unreadOnly ?? false);
  }

  // Declarado antes que ":id" para que "unread-count" no se lea como id.
  @Get('unread-count')
  async unreadCount(): Promise<{ count: number }> {
    const count = await this.alertsService.unreadCount();
    return { count };
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string): Promise<IAlertResponse> {
    return this.alertsService.markRead(id);
  }

  @Post('read-all')
  markAllRead(): Promise<{ updated: number }> {
    return this.alertsService.markAllRead();
  }
}
