import { Controller, Get, Post } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { RequirePermission } from '../auth/decorators';

@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @RequirePermission('platform', 'read')
  @Get()
  list() {
    return this.schedules.list();
  }

  /** Manual trigger; the same generation also runs periodically. */
  @RequirePermission('platform', 'manage')
  @Post('run')
  run() {
    return this.schedules.runAll();
  }
}
