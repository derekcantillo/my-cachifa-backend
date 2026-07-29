import { Injectable, NotFoundException } from '@nestjs/common';
import { GoalStatus, Prisma } from '@prisma/client';
import { CurrentUserService } from '@common/services/current-user.service';
import { PrismaService } from '@modules/prisma/prisma.service';
import type { CreateContributionDto } from './dto/create-contribution.dto';
import type { CreateGoalDto } from './dto/create-goal.dto';
import type { UpdateGoalDto } from './dto/update-goal.dto';
import {
  toGoalResponse,
  type GoalWithContributions,
  type IGoalResponse,
} from './interfaces/goal-response.interface';

const CONTRIBUTIONS_DESC = {
  contributions: { orderBy: { contributedAt: 'desc' as const } },
};

@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async findAll(): Promise<IGoalResponse[]> {
    const userId = await this.currentUser.getUserId();

    const goals = await this.prisma.goal.findMany({
      where: { userId },
      include: CONTRIBUTIONS_DESC,
      orderBy: { createdAt: 'asc' },
    });

    return goals.map(toGoalResponse);
  }

  async findOne(id: string): Promise<IGoalResponse> {
    const userId = await this.currentUser.getUserId();
    return toGoalResponse(await this.findOwned(id, userId));
  }

  async create(dto: CreateGoalDto): Promise<IGoalResponse> {
    const userId = await this.currentUser.getUserId();

    const created = await this.prisma.goal.create({
      data: {
        userId,
        name: dto.name,
        targetAmount: new Prisma.Decimal(dto.targetAmount),
        currentAmount: new Prisma.Decimal(dto.currentAmount ?? 0),
        targetDate: new Date(dto.targetDate),
        phase: dto.phase,
        status: dto.status ?? GoalStatus.ACTIVE,
      },
      include: CONTRIBUTIONS_DESC,
    });

    return toGoalResponse(created);
  }

  async update(id: string, dto: UpdateGoalDto): Promise<IGoalResponse> {
    const userId = await this.currentUser.getUserId();
    await this.findOwned(id, userId);

    const updated = await this.prisma.goal.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.targetAmount !== undefined
          ? { targetAmount: new Prisma.Decimal(dto.targetAmount) }
          : {}),
        ...(dto.currentAmount !== undefined
          ? { currentAmount: new Prisma.Decimal(dto.currentAmount) }
          : {}),
        ...(dto.targetDate !== undefined
          ? { targetDate: new Date(dto.targetDate) }
          : {}),
        ...(dto.phase !== undefined ? { phase: dto.phase } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      include: CONTRIBUTIONS_DESC,
    });

    return toGoalResponse(updated);
  }

  async remove(id: string): Promise<void> {
    const userId = await this.currentUser.getUserId();
    await this.findOwned(id, userId);
    await this.prisma.goal.delete({ where: { id } });
  }

  async addContribution(
    id: string,
    dto: CreateContributionDto,
  ): Promise<IGoalResponse> {
    const userId = await this.currentUser.getUserId();
    const goal = await this.findOwned(id, userId);

    const amount = new Prisma.Decimal(dto.amount);
    const nextCurrentAmount = goal.currentAmount.add(amount);
    const reachedTarget = nextCurrentAmount.greaterThanOrEqualTo(
      goal.targetAmount,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.goalContribution.create({
        data: { goalId: id, amount, note: dto.note ?? null },
      });

      return tx.goal.update({
        where: { id },
        data: {
          currentAmount: { increment: amount },
          ...(reachedTarget ? { status: GoalStatus.COMPLETED } : {}),
        },
        include: CONTRIBUTIONS_DESC,
      });
    });

    return toGoalResponse(updated);
  }

  private async findOwned(
    id: string,
    userId: string,
  ): Promise<GoalWithContributions> {
    const goal = await this.prisma.goal.findFirst({
      where: { id, userId },
      include: CONTRIBUTIONS_DESC,
    });

    if (!goal) {
      throw new NotFoundException(`Goal ${id} not found`);
    }

    return goal;
  }
}
