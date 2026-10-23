import { Module } from '@nestjs/common';
import { AuditService } from '../../common/services/audit.service';
import { BarcodesController } from './barcodes.controller';
import { BarcodesService } from './barcodes.service';

@Module({
  controllers: [BarcodesController],
  providers: [BarcodesService, AuditService],
  exports: [BarcodesService],
})
export class BarcodesModule {}
