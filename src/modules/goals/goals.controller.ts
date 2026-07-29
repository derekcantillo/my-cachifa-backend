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
} from '@nestjs/common';
import { CreateContributionDto } from './dto/create-contribution.dto';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { GoalsService } from './goals.service';
import type { IGoalResponse } from './interfaces/goal-response.interface';

@Controller('goals')
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get()
  findAll(): Promise<IGoalResponse[]> {
    return this.goalsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<IGoalResponse> {
    return this.goalsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateGoalDto): Promise<IGoalResponse> {
    return this.goalsService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateGoalDto,
  ): Promise<IGoalResponse> {
    return this.goalsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.goalsService.remove(id);
  }

  @Post(':id/contributions')
  addContribution(
    @Param('id') id: string,
    @Body() dto: CreateContributionDto,
  ): Promise<IGoalResponse> {
    return this.goalsService.addContribution(id, dto);
  }
}
