import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@config/configuration';
import { PrismaService } from '@modules/prisma/prisma.service';

/**
 * Punto único de resolución del usuario actual mientras no exista
 * autenticación (Bloque 9). Hoy devuelve el usuario dueño de `MY_WA_NUMBER`;
 * cuando lleguen los guards de auth basta con reemplazar `getUserId()` por la
 * lectura del token sin tocar los servicios que lo consumen.
 */
@Injectable()
export class CurrentUserService {
  private cachedUserId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async getUserId(): Promise<string> {
    if (this.cachedUserId) return this.cachedUserId;

    const waNumber = this.config.get('whatsapp', { infer: true }).myPhoneNumber;
    const user = await this.prisma.user.findUnique({
      where: { waNumber },
      select: { id: true },
    });

    if (!user) {
      throw new InternalServerErrorException(
        `No user found for MY_WA_NUMBER (${waNumber}). Run \`pnpm run prisma:seed\` first.`,
      );
    }

    this.cachedUserId = user.id;
    return user.id;
  }
}
