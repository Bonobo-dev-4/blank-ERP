import { Module } from '@nestjs/common';
import { AuditService } from '../../common/services/audit.service';
import { NumberingService } from '../../common/services/numbering.service';
import { BomModule } from '../bom/bom.module';
import { MrpController } from './mrp.controller';
import { MrpService } from './mrp.service';

@Module({
  imports: [BomModule],
  controllers: [MrpController],
  providers: [MrpService, AuditService, NumberingService],
  exports: [MrpService],
})
export class MrpModule {}
