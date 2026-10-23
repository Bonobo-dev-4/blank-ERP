import { Module } from '@nestjs/common';
import { AuditService } from '../../common/services/audit.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { NumberingService } from '../../common/services/numbering.service';
import { InventoryModule } from '../inventory/inventory.module';
import { FabricRollsController } from './fabric-rolls.controller';
import { FabricRollsService } from './fabric-rolls.service';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [InventoryModule],
  controllers: [MaterialsController, LocationsController, SuppliersController, FabricRollsController],
  providers: [
    MaterialsService, LocationsService, SuppliersService, FabricRollsService,
    AuditService, NumberingService, IdempotencyService,
  ],
  exports: [MaterialsService, LocationsService, SuppliersService, FabricRollsService],
})
export class MaterialsModule {}
