import Anthropic from '@anthropic-ai/sdk';
import type { IAiProvider } from '../interfaces/ai-provider.interface';
import type { IClassifiedMessage } from '../interfaces/ai-response.interface';
import { CLASSIFIER_SYSTEM_PROMPT } from '../prompts/classifier.prompt';

const FALLBACK: IClassifiedMessage = {
  type: 'unknown',
  confirmation: 'No entendí el mensaje, ¿puedes reformularlo?',
  requiresFollowUp: false,
};

export class AnthropicProvider implements IAiProvider {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async classifyMessage(rawMessage: string): Promise<IClassifiedMessage> {
    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      temperature: 0.1,
      system: CLASSIFIER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: rawMessage }],
    });

    const block = response.content[0];
    if (block.type !== 'text') return FALLBACK;

    const clean = block.text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    try {
      return JSON.parse(clean) as IClassifiedMessage;
    } catch {
      return FALLBACK;
    }
  }
}
