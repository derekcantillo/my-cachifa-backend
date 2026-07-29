import { GoogleGenerativeAI } from '@google/generative-ai';
import type { IAiProvider } from '../interfaces/ai-provider.interface';
import type { IClassifiedMessage } from '../interfaces/ai-response.interface';
import { CLASSIFIER_SYSTEM_PROMPT } from '../prompts/classifier.prompt';

const FALLBACK: IClassifiedMessage = {
  type: 'unknown',
  confirmation: 'No entendí el mensaje, ¿puedes reformularlo?',
  requiresFollowUp: false,
};

export class GeminiProvider implements IAiProvider {
  private readonly model;

  constructor(apiKey: string) {
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: CLASSIFIER_SYSTEM_PROMPT,
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 500,
      },
    });
  }

  async classifyMessage(rawMessage: string): Promise<IClassifiedMessage> {
    const result = await this.model.generateContent(rawMessage);
    const raw = result.response.text().trim();
    const clean = raw
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
