import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { FulfilmentController } from './fulfilment.controller';
import { FulfilmentService } from './fulfilment.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [FulfilmentController],
  providers: [FulfilmentService],
  exports: [FulfilmentService],
})
export class FulfilmentModule {}
