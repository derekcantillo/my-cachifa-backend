import { Injectable, NotFoundException } from '@nestjs/common';
import { Alert, AlertType, Prisma } from '@prisma/client';
import { CurrentUserService } from '@common/services/current-user.service';
import { PrismaService } from '@modules/prisma/prisma.service';
import {
  toAlertResponse,
  type IAlertResponse,
} from './interfaces/alert-response.interface';

/** Sin filtro, cuántas alertas recientes como máximo se devuelven. */
const MAX_ALERTS = 50;

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async findAll(unreadOnly: boolean): Promise<IAlertResponse[]> {
    const userId = await this.currentUser.getUserId();

    const alerts = await this.prisma.alert.findMany({
      where: { userId, ...(unreadOnly ? { read: false } : {}) },
      orderBy: { sentAt: 'desc' },
      take: MAX_ALERTS,
    });

    return alerts.map(toAlertResponse);
  }

  async unreadCount(): Promise<number> {
    const userId = await this.currentUser.getUserId();

    return this.prisma.alert.count({ where: { userId, read: false } });
  }

  async markRead(id: string): Promise<IAlertResponse> {
    const userId = await this.currentUser.getUserId();
    const alert = await this.findOwned(id, userId);

    if (alert.read) return toAlertResponse(alert);

    const updated = await this.prisma.alert.update({
      where: { id },
      data: { read: true },
    });

    return toAlertResponse(updated);
  }

  async markAllRead(): Promise<{ updated: number }> {
    const userId = await this.currentUser.getUserId();

    const { count } = await this.prisma.alert.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });

    return { updated: count };
  }

  private async findOwned(id: string, userId: string): Promise<Alert> {
    const alert = await this.prisma.alert.findFirst({
      where: { id, userId },
    });

    if (!alert) {
      throw new NotFoundException(`Alert ${id} not found`);
    }

    return alert;
  }

  /**
   * Crea el `Alert` solo si no existe ya uno del mismo `type` con este
   * `dedupeKey` — el mensaje lo lleva como prefijo `[dedupeKey]` en vez de
   * agregar una columna de referencia, ya que basta para no duplicar (una
   * `SAVINGS_TARGET_AT_RISK` por mes, una `RECURRING_EXPENSE_DUE` por mes y
   * por gasto). Recibe el cliente de Prisma para poder correr dentro de la
   * transacción de quien la invoca.
   */
  async createOnce(
    client: Prisma.TransactionClient,
    userId: string,
    type: AlertType,
    dedupeKey: string,
    message: string,
  ): Promise<void> {
    const marker = `[${dedupeKey}]`;

    const existing = await client.alert.findFirst({
      where: { userId, type, message: { startsWith: marker } },
      select: { id: true },
    });

    if (existing) return;

    await client.alert.create({
      data: { userId, type, message: `${marker} ${message}` },
    });
  }
}
