import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let authToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    // Register a test user and get token
    const email = `e2e-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    authToken = res.body.token;
  });

  it('/api/v1/auth/me (GET) returns user profile', () => {
    return request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('id');
        expect(res.body).toHaveProperty('email');
      });
  });

  it('/api/v1/system/health (GET) returns health data when authenticated', () => {
    return request(app.getHttpServer())
      .get('/api/v1/system/health')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('queues');
        expect(res.body).toHaveProperty('providers');
        expect(res.body).toHaveProperty('uploads');
      });
  });

  afterAll(async () => {
    await app.close();
  });
});
