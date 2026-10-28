import { Module } from '@nestjs/common';
import { AuditService } from '../../common/services/audit.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { IntegrationsController } from './integrations.controller';
import { ShopifyClient } from './shopify.client';
import { ShopifyService } from './shopify.service';
import { ShopifyWebhookController } from './shopify-webhook.controller';
import { ShopifyProductService } from './shopify-product.service';
import { UnicommerceClient } from './unicommerce.client';
import { UnicommerceController } from './unicommerce.controller';
import { UnicommerceService } from './unicommerce.service';

@Module({
  controllers: [IntegrationsController, UnicommerceController, ShopifyWebhookController],
  providers: [ShopifyClient, ShopifyService, ShopifyProductService, UnicommerceClient, UnicommerceService, AuditService, IdempotencyService],
  exports: [ShopifyService, ShopifyProductService, ShopifyClient, UnicommerceService, UnicommerceClient],
})
export class IntegrationsModule {}
