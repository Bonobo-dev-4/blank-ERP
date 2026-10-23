import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { DemandController } from './demand.controller';
import { DemandService } from './demand.service';

@Module({
  controllers: [DemandController],
  providers: [DemandService, IdempotencyService],
  exports: [DemandService],
})
export class DemandModule {}
