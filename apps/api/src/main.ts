import 'reflect-metadata';
import { Logger, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  // rawBody: Shopify webhooks are verified against the exact bytes received.
  const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });
  const config = app.get(ConfigService<AppConfig, true>);

  const prefix = config.get('API_GLOBAL_PREFIX', { infer: true });
  app.setGlobalPrefix(prefix);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // A request id on every request, echoed in error bodies, so a storekeeper
  // can quote one number when something goes wrong on the floor.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    req.headers['x-request-id'] = id;
    res.setHeader('x-request-id', id);
    next();
  });

  app.enableCors({
    origin: config.get('corsOrigins', { infer: true }),
    credentials: true,
    exposedHeaders: ['x-request-id', 'content-disposition'],
  });

  app.enableShutdownHooks();

  const swagger = new DocumentBuilder()
    .setTitle('DASH AND DOT Manufacturing ERP API')
    .setDescription(
      [
        'Manufacturing and inventory control API for DASH AND DOT.',
        '',
        'Conventions:',
        '- All quantities, rates and money values are DECIMAL STRINGS, never JSON numbers.',
        '- Every mutation that changes stock or production quantities requires an `idempotencyKey`.',
        '- Errors carry a stable machine-readable `code` plus the actual numbers in `details`.',
        '- Authorisation is enforced on the server for every endpoint; see /api/admin/permissions.',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addTag('Authentication')
    .addTag('Dashboard')
    .addTag('Product Master')
    .addTag('Raw Materials')
    .addTag('Fabric Rolls')
    .addTag('Stock Locations')
    .addTag('Raw Material Inventory')
    .addTag('Suppliers')
    .addTag('Purchasing')
    .addTag('Barcodes')
    .addTag('Administration')
    .addTag('Health')
    .build();

  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup(`${prefix}/docs`, app, document, {
    swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha', operationsSorter: 'alpha' },
    customSiteTitle: 'DASH AND DOT ERP API',
  });

  const port = config.get('API_PORT', { infer: true });
  await app.listen(port, '0.0.0.0');

  logger.log(`API listening on http://localhost:${port}/${prefix}`);
  logger.log(`OpenAPI docs at   http://localhost:${port}/${prefix}/docs`);
  if (!config.get('INTEGRATION_ALLOW_EXTERNAL_WRITES', { infer: true })) {
    logger.warn('External inventory writes are DISABLED (INTEGRATION_ALLOW_EXTERNAL_WRITES=false)');
  }
}

void bootstrap();
