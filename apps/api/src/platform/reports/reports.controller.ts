import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { REPORT_STATUSES, createReportSchema, listReportCategories } from '@urbivue/shared';
import { z } from 'zod';
import { ReportsService } from './reports.service';
import { Public, RequirePermission } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.service';
import { zodParse } from '../zod';

/** Public, unauthenticated surface for citizens. */
@Controller('public')
export class PublicReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Public()
  @Get('report-categories')
  categories() {
    return listReportCategories().map(({ key, module, name }) => ({ key, module, name }));
  }

  @Public()
  @Post('reports')
  create(@Body() body: unknown) {
    return this.reports.create(zodParse(createReportSchema, body));
  }

  @Public()
  @Get('reports/:id')
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.publicStatus(id);
  }
}

const transitionSchema = z.object({ status: z.enum(REPORT_STATUSES) });

/** Staff triage surface. */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @RequirePermission('platform', 'read')
  @Get()
  list(@Query('status') status?: string) {
    return this.reports.list(status);
  }

  @RequirePermission('platform', 'write')
  @Post(':id/transition')
  transition(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { status } = zodParse(transitionSchema, body);
    return this.reports.transition(id, status);
  }

  @RequirePermission('platform', 'write')
  @Post(':id/create-work-order')
  createWorkOrder(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: AuthUser }) {
    return this.reports.createWorkOrder(id, req.user.sub);
  }
}
