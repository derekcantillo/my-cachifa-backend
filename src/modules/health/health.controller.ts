import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { IHealthResponse } from './interfaces/health-response.interface';

/**
 * Public liveness endpoint — intentionally NOT protected by ApiKeyGuard so the
 * Docker/Cloudflare healthcheck can reach it without credentials.
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  @Get()
  check(): IHealthResponse {
    return { status: 'ok' };
  }
}
