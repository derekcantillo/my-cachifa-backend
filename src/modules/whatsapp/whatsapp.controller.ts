import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { AppConfig } from '@config/configuration';
import type { IWebhookPayload } from './interfaces/whatsapp-message.interface';
import { WhatsappService } from './whatsapp.service';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';

/**
 * Meta delivers webhooks from its own IP pool and retries in bursts, so this
 * controller opts out of the global rate limit. It stays protected by the
 * HMAC signature guard and does NOT require X-API-Key.
 */
@SkipThrottle()
@Controller('webhook')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') hubVerifyToken: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    const verifyToken = this.config.get('whatsapp', {
      infer: true,
    }).verifyToken;

    if (mode === 'subscribe' && hubVerifyToken === verifyToken) {
      this.logger.log('Webhook verified successfully');
      return challenge;
    }

    this.logger.warn('Webhook verification failed — invalid token or mode');
    throw new ForbiddenException('Webhook verification failed');
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(WebhookSignatureGuard)
  receiveMessage(@Body() payload: IWebhookPayload): void {
    void this.whatsappService.processIncomingPayload(payload);
  }
}
