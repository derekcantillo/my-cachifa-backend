import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrentUserService } from '@common/services/current-user.service';
import { PrismaService } from '@modules/prisma/prisma.service';
import type { UpdateSettingsDto } from './dto/update-settings.dto';
import {
  toSettingsResponse,
  type ISettingsResponse,
} from './interfaces/settings-response.interface';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async find(): Promise<ISettingsResponse> {
    const userId = await this.currentUser.getUserId();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    return toSettingsResponse(user);
  }

  async update(dto: UpdateSettingsDto): Promise<ISettingsResponse> {
    const userId = await this.currentUser.getUserId();

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        targetSavingsPercentage: new Prisma.Decimal(
          dto.targetSavingsPercentage,
        ),
      },
    });

    return toSettingsResponse(user);
  }
}
