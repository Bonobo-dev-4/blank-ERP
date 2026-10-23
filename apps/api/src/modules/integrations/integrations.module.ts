import { Module } from '@nestjs/common';
import { AuditService } from '../../common/services/audit.service';
import { IntegrationsController } from './integrations.controller';
import { ShopifyClient } from './shopify.client';
import { ShopifyService } from './shopify.service';

@Module({
  controllers: [IntegrationsController],
  providers: [ShopifyClient, ShopifyService, AuditService],
  exports: [ShopifyService],
})
export class IntegrationsModule {}
