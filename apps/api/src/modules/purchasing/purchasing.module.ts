import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { MaterialsModule } from '../materials/materials.module';
import { PurchasingController } from './purchasing.controller';
import { PurchasingService } from './purchasing.service';

@Module({
  imports: [InventoryModule, MaterialsModule],
  controllers: [PurchasingController],
  providers: [PurchasingService],
  exports: [PurchasingService],
})
export class PurchasingModule {}
