import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@config/configuration';
import type { IAiProvider } from './interfaces/ai-provider.interface';
import type { IClassifiedMessage } from './interfaces/ai-response.interface';
import { GeminiProvider } from './providers/gemini.provider';
import { AnthropicProvider } from './providers/anthropic.provider';

const ERROR_RESPONSE: IClassifiedMessage = {
  type: 'unknown',
  confirmation: 'Ocurrió un error procesando tu mensaje, intenta de nuevo.',
  requiresFollowUp: false,
};

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private provider!: IAiProvider;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  onModuleInit(): void {
    const { provider, geminiApiKey, anthropicApiKey } = this.config.get('ai', {
      infer: true,
    });

    if (provider === 'anthropic') {
      this.provider = new AnthropicProvider(anthropicApiKey);
      this.logger.log('AI provider: Anthropic (claude-haiku-4-5-20251001)');
    } else {
      this.provider = new GeminiProvider(geminiApiKey);
      this.logger.log('AI provider: Gemini (gemini-2.0-flash)');
    }
  }

  async classifyMessage(rawMessage: string): Promise<IClassifiedMessage> {
    try {
      return await this.provider.classifyMessage(rawMessage);
    } catch (err) {
      this.logger.error('classifyMessage failed', err);
      return ERROR_RESPONSE;
    }
  }
}
