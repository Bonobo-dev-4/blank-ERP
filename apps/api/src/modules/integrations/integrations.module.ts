import { Module } from '@nestjs/common';
import { AuditService } from '../../common/services/audit.service';
import { IntegrationsController } from './integrations.controller';
import { ShopifyClient } from './shopify.client';
import { ShopifyService } from './shopify.service';
import { UnicommerceClient } from './unicommerce.client';
import { UnicommerceController } from './unicommerce.controller';
import { UnicommerceService } from './unicommerce.service';

@Module({
  controllers: [IntegrationsController, UnicommerceController],
  providers: [ShopifyClient, ShopifyService, UnicommerceClient, UnicommerceService, AuditService],
  exports: [ShopifyService, UnicommerceService],
})
export class IntegrationsModule {}
