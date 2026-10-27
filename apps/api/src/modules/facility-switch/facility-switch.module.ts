import { Module } from '@nestjs/common';
import { AuditService } from '../../common/services/audit.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { FacilitySwitchController } from './facility-switch.controller';
import { FacilitySwitchService } from './facility-switch.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [FacilitySwitchController],
  providers: [FacilitySwitchService, AuditService],
})
export class FacilitySwitchModule {}
