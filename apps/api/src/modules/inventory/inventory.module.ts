import { Module } from '@nestjs/common';
import { AuditService } from '../../common/services/audit.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { NumberingService } from '../../common/services/numbering.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { LedgerService } from './ledger.service';

@Module({
  controllers: [InventoryController],
  providers: [LedgerService, InventoryService, NumberingService, AuditService, IdempotencyService],
  exports: [LedgerService, InventoryService, NumberingService, AuditService, IdempotencyService],
})
export class InventoryModule {}
