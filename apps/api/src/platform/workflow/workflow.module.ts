import { Module } from '@nestjs/common';
import { InspectionsService } from './inspections.service';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';
import { WorkOrdersService } from './work-orders.service';
import {
  InspectionTemplatesController,
  InspectionsController,
  WorkOrdersController,
} from './workflow.controllers';

@Module({
  controllers: [
    InspectionTemplatesController,
    InspectionsController,
    WorkOrdersController,
    SchedulesController,
  ],
  providers: [InspectionsService, WorkOrdersService, SchedulesService],
  exports: [WorkOrdersService],
})
export class WorkflowModule {}
