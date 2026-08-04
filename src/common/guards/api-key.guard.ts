import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '@config/configuration';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers['x-api-key'];
    const expected = this.config.get('apiKey', { infer: true });

    const provided = Array.isArray(header) ? header[0] : header;

    if (!provided) {
      this.logger.warn(`Missing X-API-Key header on ${request.url}`);
      throw new UnauthorizedException('Unauthorized');
    }

    const providedBuffer = Buffer.from(provided, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    if (providedBuffer.byteLength !== expectedBuffer.byteLength) {
      this.logger.warn(`Invalid X-API-Key on ${request.url}`);
      throw new UnauthorizedException('Unauthorized');
    }

    if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
      this.logger.warn(`Invalid X-API-Key on ${request.url}`);
      throw new UnauthorizedException('Unauthorized');
    }

    return true;
  }
}
