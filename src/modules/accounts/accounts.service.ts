import { Injectable } from '@nestjs/common';
import { CurrentUserService } from '@common/services/current-user.service';
import { PrismaService } from '@modules/prisma/prisma.service';
import type { CreateAccountDto } from './dto/create-account.dto';
import {
  toAccountResponse,
  type IAccountResponse,
} from './interfaces/account-response.interface';

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async findAll(): Promise<IAccountResponse[]> {
    const userId = await this.currentUser.getUserId();

    const accounts = await this.prisma.account.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    return accounts.map(toAccountResponse);
  }

  async create(dto: CreateAccountDto): Promise<IAccountResponse> {
    const userId = await this.currentUser.getUserId();

    const account = await this.prisma.account.create({
      data: { userId, name: dto.name, type: dto.type },
    });

    return toAccountResponse(account);
  }
}
