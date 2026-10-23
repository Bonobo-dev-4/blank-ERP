import { Module } from '@nestjs/common';
import { AuditService } from '../../common/services/audit.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, AuditService],
})
export class AdminModule {}
