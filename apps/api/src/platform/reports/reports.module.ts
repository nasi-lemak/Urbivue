import { Module } from '@nestjs/common';
import { PublicReportsController, ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [PublicReportsController, ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
