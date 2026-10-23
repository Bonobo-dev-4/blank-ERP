import { Module } from '@nestjs/common';
import { AuditService } from '../../common/services/audit.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { NumberingService } from '../../common/services/numbering.service';
import { BomModule } from '../bom/bom.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MrpModule } from '../mrp/mrp.module';
import { ManufacturingController } from './manufacturing.controller';
import { ManufacturingService } from './manufacturing.service';

@Module({
  imports: [BomModule, MrpModule, InventoryModule],
  controllers: [ManufacturingController],
  providers: [ManufacturingService, AuditService, NumberingService, IdempotencyService],
  exports: [ManufacturingService],
})
export class ManufacturingModule {}
