import { Module } from '@nestjs/common';
import { AuditService } from '../../common/services/audit.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { NumberingService } from '../../common/services/numbering.service';
import { ProductionModule } from '../production/production.module';
import { QualityController } from './quality.controller';
import { QualityService } from './quality.service';

@Module({
  imports: [ProductionModule],
  controllers: [QualityController],
  providers: [QualityService, AuditService, NumberingService, IdempotencyService],
  exports: [QualityService],
})
export class QualityModule {}
