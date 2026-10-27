import { Module } from '@nestjs/common';
import { AuditService } from '../../common/services/audit.service';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';

@Module({
  controllers: [BrandingController],
  providers: [BrandingService, AuditService],
})
export class BrandingModule {}
