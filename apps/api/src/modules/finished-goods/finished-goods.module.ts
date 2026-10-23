import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { FinishedGoodsController } from './finished-goods.controller';
import { FinishedGoodsService } from './finished-goods.service';

@Module({
  controllers: [FinishedGoodsController],
  providers: [FinishedGoodsService, IdempotencyService],
  exports: [FinishedGoodsService],
})
export class FinishedGoodsModule {}
