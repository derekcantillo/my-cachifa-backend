import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '@config/configuration';

interface RawBodyRequest extends FastifyRequest {
  rawBody?: Buffer | string | null;
}

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest>();
    const signature = request.headers['x-hub-signature-256'];
    const rawBody = request.rawBody;
    const secret = this.config.get('whatsapp', { infer: true }).webhookSecret;

    if (!signature || !rawBody) {
      this.logger.warn('Missing X-Hub-Signature-256 header or raw body');
      throw new ForbiddenException('Invalid webhook signature');
    }

    const sigString = Array.isArray(signature) ? signature[0] : signature;
    if (!sigString) {
      this.logger.warn('Empty X-Hub-Signature-256 header');
      throw new ForbiddenException('Invalid webhook signature');
    }

    const expectedSignature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

    const sigBuffer = Buffer.from(sigString, 'ascii');
    const expectedBuffer = Buffer.from(expectedSignature, 'ascii');

    if (sigBuffer.byteLength !== expectedBuffer.byteLength) {
      this.logger.warn('Webhook signature verification failed — length mismatch');
      throw new ForbiddenException('Invalid webhook signature');
    }

    if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
      this.logger.warn('Webhook signature verification failed');
      throw new ForbiddenException('Invalid webhook signature');
    }

    return true;
  }
}
