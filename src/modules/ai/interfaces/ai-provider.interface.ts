import type { IClassifiedMessage } from './ai-response.interface';

export interface IAiProvider {
  classifyMessage(rawMessage: string): Promise<IClassifiedMessage>;
}
