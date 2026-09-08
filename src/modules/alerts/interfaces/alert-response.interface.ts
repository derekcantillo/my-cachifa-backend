import type { Alert, AlertType } from '@prisma/client';

export interface IAlertResponse {
  id: string;
  type: AlertType;
  message: string;
  read: boolean;
  sentAt: string;
}

export function toAlertResponse(alert: Alert): IAlertResponse {
  return {
    id: alert.id,
    type: alert.type,
    message: alert.message,
    read: alert.read,
    sentAt: alert.sentAt.toISOString(),
  };
}
