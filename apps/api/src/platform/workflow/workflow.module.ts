import { Module } from '@nestjs/common';
import { InspectionsService } from './inspections.service';
import { WorkOrdersService } from './work-orders.service';
import {
  InspectionTemplatesController,
  InspectionsController,
  WorkOrdersController,
} from './workflow.controllers';

@Module({
  controllers: [InspectionTemplatesController, InspectionsController, WorkOrdersController],
  providers: [InspectionsService, WorkOrdersService],
  exports: [WorkOrdersService],
})
export class WorkflowModule {}
