import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  loadEnv();
  // Imported after loadEnv so module factories see the configuration.
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.disable('x-powered-by');
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
