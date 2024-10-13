import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 4242;
  const nodeEnv = configService.get<string>('NODE_ENV') || 'development';

  // Setup Swagger
  const config = new DocumentBuilder()
    .setTitle('API Documentation')
    .setDescription('The API description for the NestJS application')
    .setVersion('1.0')
    .addBearerAuth() // Add Bearer token authorization if needed
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document); // Serve docs at /api-docs

  app.useLogger(app.get(Logger));

  // Enable CORS based on environment
  app.enableCors({
    origin:
      nodeEnv === 'development'
        ? 'http://localhost:3000'
        : ['https://histori.xyz', 'https://checkout.stripe.com'],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true, // Allows sending cookies or authorization headers with cross-origin requests
    allowedHeaders:
      'Content-Type, Accept, Authorization, X-API-KEY, Access-Control-Allow-Origin, Access-Control-Allow-Headers, Origin, X-Requested-With, Referer, User-Agent',
    exposedHeaders: 'Authorization, X-API-KEY',
  });

  app.useGlobalPipes(new ValidationPipe());

  await app.listen(port, '127.0.0.1');
}
bootstrap();
