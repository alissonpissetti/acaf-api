import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, RequestMethod } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('Partner API (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api', {
      exclude: [{ path: 'test', method: RequestMethod.GET }],
    });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/test (GET)', () => {
    return request(app.getHttpServer())
      .get('/test')
      .expect(200)
      .expect((res) => {
        expect(res.body.ok).toBe(true);
        expect(res.body.service).toBe('acaf-api');
      });
  });

  it('/api/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok', service: 'acaf-api' });
  });

  it('/api/bootstrap (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/bootstrap')
      .expect(200)
      .expect((res) => {
        expect(res.body.networkId).toBeTruthy();
        expect(Array.isArray(res.body.units)).toBe(true);
      });
  });
});
