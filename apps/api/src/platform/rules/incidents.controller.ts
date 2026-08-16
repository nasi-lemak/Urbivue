import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { RequirePermission } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.service';

const INCIDENT_COLUMNS = `
  i.id, i.severity, i.status, i.title, i.detail,
  i.opened_at AS "openedAt", i.acknowledged_at AS "acknowledgedAt",
  i.resolved_at AS "resolvedAt",
  r.key AS "ruleKey", r.module,
  s.external_id AS "sensorExternalId", i.asset_id AS "assetId"`;

const INCIDENT_FROM = `
  FROM incidents i
  LEFT JOIN alert_rules r ON r.id = i.rule_id
  LEFT JOIN sensors s ON s.id = i.sensor_id`;

@Controller('incidents')
export class IncidentsController {
  constructor(private readonly db: DbService) {}

  @RequirePermission('platform', 'read')
  @Get()
  async list(@Query('status') status = 'unresolved') {
    if (!['open', 'acknowledged', 'resolved', 'unresolved', 'all'].includes(status)) {
      throw new BadRequestException(`Unknown status filter '${status}'`);
    }
    const where =
      status === 'all'
        ? 'TRUE'
        : status === 'unresolved'
          ? `i.status <> 'resolved'`
          : `i.status = $1::incident_status`;
    const params = status === 'all' || status === 'unresolved' ? [] : [status];
    const result = await this.db.query(
      `SELECT ${INCIDENT_COLUMNS} ${INCIDENT_FROM}
       WHERE ${where}
       ORDER BY i.opened_at DESC
       LIMIT 200`,
      params,
    );
    return result.rows;
  }

  @RequirePermission('platform', 'write')
  @Post(':id/acknowledge')
  async acknowledge(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: AuthUser }) {
    const result = await this.db.query(
      `UPDATE incidents SET status = 'acknowledged', acknowledged_at = now(), acknowledged_by = $2
       WHERE id = $1 AND status = 'open'
       RETURNING id`,
      [id, req.user.sub],
    );
    if (!result.rowCount) throw new NotFoundException(`No open incident ${id}`);
    return { id, status: 'acknowledged' };
  }

  @RequirePermission('platform', 'write')
  @Post(':id/resolve')
  async resolve(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: AuthUser }) {
    const result = await this.db.query(
      `UPDATE incidents SET status = 'resolved', resolved_at = now(), resolved_by = $2
       WHERE id = $1 AND status <> 'resolved'
       RETURNING id`,
      [id, req.user.sub],
    );
    if (!result.rowCount) throw new NotFoundException(`No unresolved incident ${id}`);
    return { id, status: 'resolved' };
  }
}
