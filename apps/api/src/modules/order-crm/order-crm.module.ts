import { Module } from '@nestjs/common';
import { AuditService } from '../../common/services/audit.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { OrderCrmController } from './order-crm.controller';
import { OrderCrmService } from './order-crm.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [OrderCrmController],
  providers: [OrderCrmService, AuditService],
})
export class OrderCrmModule {}
