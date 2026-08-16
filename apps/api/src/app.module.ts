import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { DbModule } from './platform/db/db.module';
import { AuthModule } from './platform/auth/auth.module';
import { AuthGuard } from './platform/auth/auth.guard';
import { PermissionGuard } from './platform/auth/permission.guard';
import { AuditInterceptor } from './platform/audit/audit.interceptor';
import { AssetsModule } from './platform/assets/assets.module';
import { RulesModule } from './platform/rules/rules.module';
import { TelemetryModule } from './platform/telemetry/telemetry.module';
import { HealthController } from './platform/health.controller';

@Module({
  imports: [DbModule, AuthModule, AssetsModule, RulesModule, TelemetryModule],
  controllers: [HealthController],
  providers: [
    // Order matters: authenticate first, then authorize.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
