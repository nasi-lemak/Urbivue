import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { DbModule } from './platform/db/db.module';
import { NotificationsModule } from './platform/notifications/notifications.module';
import { AuthModule } from './platform/auth/auth.module';
import { AuthGuard } from './platform/auth/auth.guard';
import { PermissionGuard } from './platform/auth/permission.guard';
import { AuditInterceptor } from './platform/audit/audit.interceptor';
import { AssetsModule } from './platform/assets/assets.module';
import { RulesModule } from './platform/rules/rules.module';
import { TelemetryModule } from './platform/telemetry/telemetry.module';
import { WorkflowModule } from './platform/workflow/workflow.module';
import { ReportsModule } from './platform/reports/reports.module';
import { EventsModule } from './platform/events/events.module';
import { PumpsModule } from './modules/pumps/pumps.module';
import { SlopesModule } from './modules/slopes/slopes.module';
import { HealthController } from './platform/health.controller';

@Module({
  imports: [
    DbModule,
    NotificationsModule,
    EventsModule,
    AuthModule,
    AssetsModule,
    RulesModule,
    TelemetryModule,
    WorkflowModule,
    ReportsModule,
    PumpsModule,
    SlopesModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: authenticate first, then authorize.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
