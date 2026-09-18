import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import type { INetWorthResponse } from './interfaces/net-worth-response.interface';
import { NetWorthService } from './net-worth.service';

@UseGuards(ApiKeyGuard)
@Controller('net-worth')
export class NetWorthController {
  constructor(private readonly netWorthService: NetWorthService) {}

  @Get()
  getNetWorth(): Promise<INetWorthResponse> {
    return this.netWorthService.getNetWorth();
  }
}
