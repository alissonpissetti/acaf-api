import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupSwagger } from './swagger/setup-swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  const express = await import('express');
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'test', method: RequestMethod.GET },
      { path: 'shared/connect_domain.json', method: RequestMethod.GET },
    ],
  });
  app.enableCors();

  setupSwagger(app);

  const http = app.getHttpAdapter().getInstance();
  http.get('/', (_req: unknown, res: { redirect: (code: number, url: string) => void }) => {
    res.redirect(302, '/docs');
  });

  const port = Number(process.env.PORT ?? 8787);
  await app.listen(port);
}
bootstrap();
