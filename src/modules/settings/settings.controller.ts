import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import type { ISettingsResponse } from './interfaces/settings-response.interface';
import { SettingsService } from './settings.service';

@UseGuards(ApiKeyGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  find(): Promise<ISettingsResponse> {
    return this.settingsService.find();
  }

  @Patch()
  update(@Body() dto: UpdateSettingsDto): Promise<ISettingsResponse> {
    return this.settingsService.update(dto);
  }
}
