import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import {
  createWorkOrderSchema,
  listInspectionTemplates,
  submitInspectionSchema,
} from '@urbivue/shared';
import { z } from 'zod';
import { InspectionsService } from './inspections.service';
import { WorkOrdersService } from './work-orders.service';
import { RequirePermission } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.service';
import { zodParse } from '../zod';

type AuthedRequest = { user: AuthUser };

@Controller('inspection-templates')
export class InspectionTemplatesController {
  @RequirePermission('platform', 'read')
  @Get()
  list(@Query('assetType') assetType?: string) {
    return listInspectionTemplates().filter((t) => !assetType || t.assetTypeId === assetType);
  }
}

@Controller('inspections')
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  @RequirePermission('platform', 'read')
  @Get('asset/:assetId')
  forAsset(@Param('assetId', ParseUUIDPipe) assetId: string) {
    return this.inspections.listForAsset(assetId);
  }

  @RequirePermission('platform', 'write')
  @Post()
  submit(@Body() body: unknown, @Req() req: AuthedRequest) {
    return this.inspections.submit(zodParse(submitInspectionSchema, body), req.user.sub);
  }
}

const assignSchema = z.object({ assigneeId: z.string().uuid().optional() });
const completeSchema = z.object({ completionNotes: z.string().max(4000).optional() });

@Controller('work-orders')
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @RequirePermission('platform', 'read')
  @Get()
  list(@Query('status') status?: string, @Query('mine') mine?: string, @Req() req?: AuthedRequest) {
    return this.workOrders.list({
      status,
      assigneeId: mine === 'true' ? req?.user.sub : undefined,
    });
  }

  @RequirePermission('platform', 'write')
  @Post()
  create(@Body() body: unknown, @Req() req: AuthedRequest) {
    return this.workOrders.create(zodParse(createWorkOrderSchema, body), req.user.sub);
  }

  @RequirePermission('platform', 'write')
  @Post(':id/assign')
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const { assigneeId } = zodParse(assignSchema, body ?? {});
    // Default: assign to the acting user ("take this job").
    return this.workOrders.transition(id, 'assigned', req.user.sub, {
      assigneeId: assigneeId ?? req.user.sub,
    });
  }

  @RequirePermission('platform', 'write')
  @Post(':id/start')
  start(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.workOrders.transition(id, 'in_progress', req.user.sub);
  }

  @RequirePermission('platform', 'write')
  @Post(':id/complete')
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const { completionNotes } = zodParse(completeSchema, body ?? {});
    return this.workOrders.transition(id, 'done', req.user.sub, { completionNotes });
  }

  @RequirePermission('platform', 'write')
  @Post(':id/verify')
  verify(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.workOrders.transition(id, 'verified', req.user.sub);
  }

  @RequirePermission('platform', 'write')
  @Post(':id/reopen')
  reopen(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.workOrders.transition(id, 'in_progress', req.user.sub);
  }

  @RequirePermission('platform', 'manage')
  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.workOrders.transition(id, 'cancelled', req.user.sub);
  }
}
