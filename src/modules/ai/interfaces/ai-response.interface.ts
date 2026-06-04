export type MessageType =
  | 'expense'
  | 'income'
  | 'saving'
  | 'debt_payment'
  | 'query'
  | 'unknown';

export type ExpenseCategory =
  | 'FOOD'
  | 'TRANSPORT'
  | 'ENTERTAINMENT'
  | 'SERVICES'
  | 'DEBT'
  | 'SAVING'
  | 'VEHICLE'
  | 'HEALTH'
  | 'OTHER';

export interface IClassifiedMessage {
  type: MessageType;
  amount?: number;
  category?: ExpenseCategory;
  description?: string;
  confirmation: string;
  requiresFollowUp: boolean;
  followUpQuestion?: string;
}
