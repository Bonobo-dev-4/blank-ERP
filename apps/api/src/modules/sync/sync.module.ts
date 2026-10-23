import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
