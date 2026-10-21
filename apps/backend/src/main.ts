/**
 * Backend entry point.
 *
 * All routes are served under the `/api` prefix, e.g. `POST /api/auth/request-otp`.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

export const API_PREFIX = 'api';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix(API_PREFIX);

  app.enableCors({
    origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Retry-After'],
  });

  app.use(helmet());
  // Auth payloads are tiny; reject anything bigger early.
  app.useBodyParser('json', { limit: '10kb' });
  // Behind a reverse proxy, set TRUST_PROXY (e.g. `1`) so rate limits see the real client IP.
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  Logger.log(`Backend running on http://localhost:${port}/${API_PREFIX}`, 'Bootstrap');
}

void bootstrap();
