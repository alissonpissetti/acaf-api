import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  const express = await import('express');
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  app.setGlobalPrefix('api', {
    exclude: [{ path: 'shared/connect_domain.json', method: RequestMethod.GET }],
  });
  app.enableCors();

  const port = Number(process.env.PORT ?? 8787);
  await app.listen(port);
}
bootstrap();
