import { Module } from '@nestjs/common';
import { AuditService } from '../../common/services/audit.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, AuditService],
  exports: [ProductsService],
})
export class ProductsModule {}
