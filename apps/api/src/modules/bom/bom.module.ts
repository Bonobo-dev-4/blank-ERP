import { Module } from '@nestjs/common';
import { AuditService } from '../../common/services/audit.service';
import { NumberingService } from '../../common/services/numbering.service';
import { BomController } from './bom.controller';
import { BomService } from './bom.service';

@Module({
  controllers: [BomController],
  providers: [BomService, AuditService, NumberingService],
  exports: [BomService],
})
export class BomModule {}
