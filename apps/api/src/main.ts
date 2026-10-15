import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config';

export async function createApp() {
  const config = loadConfig();
  // rawBody is needed to verify Paystack webhook signatures.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const origins = config.CORS_ORIGINS.split(',').map((o) => o.trim());
  app.enableCors({
    // The ordering app is native (no Origin header); browsers are limited to the admin/console.
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) =>
      cb(null, !origin || origins.includes(origin)),
    credentials: false,
  });
  app.enableShutdownHooks();
  return app;
}

async function bootstrap() {
  const app = await createApp();
  const port = loadConfig().PORT;
  await app.listen(port);
  new Logger('Cullinari').log(`API listening on http://localhost:${port}`);
}

if (require.main === module) {
  void bootstrap();
}
