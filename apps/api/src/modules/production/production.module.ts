import { Module } from '@nestjs/common';
import { AuditService } from '../../common/services/audit.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { NumberingService } from '../../common/services/numbering.service';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';

@Module({
  controllers: [ProductionController],
  providers: [ProductionService, AuditService, NumberingService, IdempotencyService],
  exports: [ProductionService],
})
export class ProductionModule {}
