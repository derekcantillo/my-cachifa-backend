import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { FinancialInstitution } from '@prisma/client';
import { CurrentUserService } from '@common/services/current-user.service';
import { PrismaService } from '@modules/prisma/prisma.service';
import type { CreateInstitutionDto } from './dto/create-institution.dto';
import type { UpdateInstitutionDto } from './dto/update-institution.dto';
import {
  toInstitutionResponse,
  type IInstitutionResponse,
} from './interfaces/institution-response.interface';

export const institutionExistsMessage = (name: string) =>
  `Institution "${name}" already exists`;

export const institutionInUseMessage = (accountCount: number) =>
  `Institution has ${accountCount} product(s): move or unlink them first`;

/** Bancos y billeteras que agrupan las cuentas en "Mis productos". */
@Injectable()
export class InstitutionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async findAll(): Promise<IInstitutionResponse[]> {
    const userId = await this.currentUser.getUserId();

    const institutions = await this.prisma.financialInstitution.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { accounts: true } } },
    });

    return institutions.map((institution) =>
      toInstitutionResponse(institution, institution._count.accounts),
    );
  }

  async create(dto: CreateInstitutionDto): Promise<IInstitutionResponse> {
    const userId = await this.currentUser.getUserId();
    await this.assertNameAvailable(userId, dto.name);

    const institution = await this.prisma.financialInstitution.create({
      data: { userId, name: dto.name },
    });

    return toInstitutionResponse(institution, 0);
  }

  async update(
    id: string,
    dto: UpdateInstitutionDto,
  ): Promise<IInstitutionResponse> {
    const userId = await this.currentUser.getUserId();
    await this.findOwned(id, userId);
    await this.assertNameAvailable(userId, dto.name, id);

    const institution = await this.prisma.financialInstitution.update({
      where: { id },
      data: { name: dto.name },
      include: { _count: { select: { accounts: true } } },
    });

    return toInstitutionResponse(institution, institution._count.accounts);
  }

  /** Solo sin productos: una cuenta no queda sin entidad por accidente. */
  async remove(id: string): Promise<void> {
    const userId = await this.currentUser.getUserId();
    await this.findOwned(id, userId);

    const accountCount = await this.prisma.account.count({
      where: { institutionId: id },
    });
    if (accountCount > 0) {
      throw new BadRequestException(institutionInUseMessage(accountCount));
    }

    await this.prisma.financialInstitution.delete({ where: { id } });
  }

  private async findOwned(
    id: string,
    userId: string,
  ): Promise<FinancialInstitution> {
    const institution = await this.prisma.financialInstitution.findFirst({
      where: { id, userId },
    });

    if (!institution) {
      throw new NotFoundException(`Institution ${id} not found`);
    }

    return institution;
  }

  /**
   * Único por usuario sin distinguir mayúsculas: "bancolombia" y "Bancolombia"
   * serían la misma entidad partida en dos grupos. La base solo garantiza el
   * nombre exacto (`@@unique([userId, name])`).
   */
  private async assertNameAvailable(
    userId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await this.prisma.financialInstitution.findFirst({
      where: {
        userId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });

    if (existing) {
      throw new ConflictException(institutionExistsMessage(existing.name));
    }
  }
}
