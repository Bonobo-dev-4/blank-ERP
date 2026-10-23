import { Module } from '@nestjs/common';
import { AuditService } from '../../common/services/audit.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { NumberingService } from '../../common/services/numbering.service';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductionModule } from '../production/production.module';
import { CuttingController } from './cutting.controller';
import { CuttingService } from './cutting.service';

@Module({
  imports: [InventoryModule, ProductionModule],
  controllers: [CuttingController],
  providers: [CuttingService, AuditService, NumberingService, IdempotencyService],
  exports: [CuttingService],
})
export class CuttingModule {}
