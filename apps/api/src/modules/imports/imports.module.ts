import { Module } from '@nestjs/common';
import { AuditService } from '../../common/services/audit.service';
import { MaterialsModule } from '../materials/materials.module';
import { ProductsModule } from '../products/products.module';
import { InventoryModule } from '../inventory/inventory.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [MaterialsModule, ProductsModule, InventoryModule, IntegrationsModule],
  controllers: [ImportsController],
  providers: [ImportsService, AuditService],
})
export class ImportsModule {}
