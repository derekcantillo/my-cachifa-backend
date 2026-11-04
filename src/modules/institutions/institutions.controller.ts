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
import { CreateInstitutionDto } from './dto/create-institution.dto';
import { UpdateInstitutionDto } from './dto/update-institution.dto';
import type { IInstitutionResponse } from './interfaces/institution-response.interface';
import { InstitutionsService } from './institutions.service';

@UseGuards(ApiKeyGuard)
@Controller('institutions')
export class InstitutionsController {
  constructor(private readonly institutionsService: InstitutionsService) {}

  @Get()
  findAll(): Promise<IInstitutionResponse[]> {
    return this.institutionsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateInstitutionDto): Promise<IInstitutionResponse> {
    return this.institutionsService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInstitutionDto,
  ): Promise<IInstitutionResponse> {
    return this.institutionsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.institutionsService.remove(id);
  }
}
