import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@config/configuration';
import type { IWebhookPayload } from './interfaces/whatsapp-message.interface';
import type {
  ISendMessagePayload,
  ISendMessageResponse,
} from './interfaces/whatsapp-api.interface';
import { AiService } from '@modules/ai/ai.service';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly aiService: AiService,
  ) {}

  async processIncomingPayload(payload: IWebhookPayload): Promise<void> {
    const message = payload.entry[0]?.changes[0]?.value.messages?.[0];
    if (!message || message.type !== 'text' || !message.text?.body) return;

    const myNumber = this.config.get('whatsapp', { infer: true }).myPhoneNumber;
    if (message.from !== myNumber) {
      this.logger.warn(
        `Received message from unexpected number: ${message.from}`,
      );
      return;
    }

    this.logger.log(
      `Incoming message from ${message.from}: ${message.text.body}`,
    );
    await this.handleTextMessage(message.from, message.text.body);
  }

  async handleTextMessage(from: string, text: string): Promise<void> {
    this.logger.log(`Handling text message from ${from}: ${text}`);

    const result = await this.aiService.classifyMessage(text);
    this.logger.log(`Classified message: ${JSON.stringify(result)}`);

    if (result.requiresFollowUp && result.followUpQuestion) {
      await this.sendMessage(from, result.followUpQuestion);
    } else {
      await this.sendMessage(from, result.confirmation);
    }
  }

  async sendMessage(to: string, body: string): Promise<void> {
    const { phoneNumberId, accessToken } = this.config.get('whatsapp', {
      infer: true,
    });
    const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

    const payload: ISendMessagePayload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(
        `Failed to send message: ${response.status} ${errorBody}`,
      );
      return;
    }

    const result = (await response.json()) as ISendMessageResponse;
    this.logger.log(`Message sent, id: ${result.messages[0]?.id}`);
  }

  async sendTypingIndicator(to: string, messageId: string): Promise<void> {
    const { phoneNumberId, accessToken } = this.config.get('whatsapp', {
      infer: true,
    });
    const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

    this.logger.log(
      `Sending typing indicator to ${to} for message ${messageId}`,
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(
        `Failed to send typing indicator: ${response.status} ${errorBody}`,
      );
    }
  }
}
