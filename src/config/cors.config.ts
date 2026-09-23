import type { NestFastifyApplication } from '@nestjs/platform-fastify';

type CorsOptions = NonNullable<
  Parameters<NestFastifyApplication['enableCors']>[0]
>;

/**
 * Browser clients (the web dashboard) authenticate with the `X-API-Key` header,
 * not cookies, so any origin stays allowed. What has to be explicit are the
 * methods: `@fastify/cors` defaults to `GET,HEAD,POST`, which made the browser
 * reject every PATCH/PUT/DELETE at the preflight.
 */
export const CORS_OPTIONS: CorsOptions = {
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  // Lets the browser cache the preflight instead of repeating it per request
  // (Chromium caps this at 2 h).
  maxAge: 7200,
};
