import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { JwtAuthGuard, PermissionsGuard } from './common/auth/guards';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { DecimalSerializerInterceptor } from './common/interceptors/decimal-serializer.interceptor';
import { PrismaModule } from './common/prisma/prisma.module';
import { loadConfiguration } from './config/configuration';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { BarcodesModule } from './modules/barcodes/barcodes.module';
import { BomModule } from './modules/bom/bom.module';
import { CuttingModule } from './modules/cutting/cutting.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ManufacturingModule } from './modules/manufacturing/manufacturing.module';
import { MaterialsModule } from './modules/materials/materials.module';
import { MrpModule } from './modules/mrp/mrp.module';
import { ProductionModule } from './modules/production/production.module';
import { ProductsModule } from './modules/products/products.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { QualityModule } from './modules/quality/quality.module';

/**
 * Modular monolith root.
 *
 * Two things are deliberately registered GLOBALLY rather than per controller:
 *
 *  - JwtAuthGuard and PermissionsGuard, so an endpoint is protected unless it
 *    opts out with @Public(). Forgetting a guard should fail closed.
 *  - DecimalSerializerInterceptor, so no endpoint can accidentally emit a
 *    quantity as a JSON float.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, load: [() => loadConfiguration()] }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,

    AuthModule,
    AdminModule,
    ProductsModule,
    MaterialsModule,
    InventoryModule,
    PurchasingModule,
    BomModule,
    MrpModule,
    ManufacturingModule,
    ProductionModule,
    QualityModule,
    CuttingModule,
    BarcodesModule,
    DashboardModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: DecimalSerializerInterceptor },
  ],
})
export class AppModule {}
