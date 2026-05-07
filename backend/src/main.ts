import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import express from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression = require('compression');
import cookieParser = require('cookie-parser');
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
  });
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ limit: '5mb', extended: true }));

  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:5173'],
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const config = new DocumentBuilder()
    .setTitle('Bug Intelligence API')
    .setDescription('AI-powered browser observability platform')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'api-key')
    .build();
  SwaggerModule.setup('api/v1/docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`Bug Intelligence API running on port ${port}`);
}

bootstrap();

