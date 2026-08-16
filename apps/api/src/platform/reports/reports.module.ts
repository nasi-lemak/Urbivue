import { Module } from '@nestjs/common';
import { PublicReportsController, ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PublicRateLimitGuard } from '../auth/rate-limit.guard';

@Module({
  controllers: [PublicReportsController, ReportsController],
  providers: [ReportsService, PublicRateLimitGuard],
})
export class ReportsModule {}
