import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { RequirePermission } from '../auth/decorators';

/**
 * Cross-module operations analytics: asset condition per module, incident
 * and work-order throughput, citizen-report responsiveness. Ward-level
 * scorecards arrive with the zones entity.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly db: DbService) {}

  async overview() {
    const [modules, incidents, workOrders, reports] = await Promise.all([
      this.db.query(
        `SELECT t.module,
                count(*)::int AS assets,
                count(*) FILTER (WHERE a.status = 'needs_attention')::int AS "needsAttention",
                count(*) FILTER (WHERE a.condition_score <= 2)::int AS "poorCondition"
         FROM assets a
         JOIN asset_types t ON t.id = a.type_id
         WHERE a.status <> 'decommissioned'
         GROUP BY t.module
         ORDER BY t.module`,
      ),
      this.db.query(
        `SELECT count(*) FILTER (WHERE status <> 'resolved')::int AS open,
                count(*) FILTER (WHERE status <> 'resolved' AND severity = 'critical')::int
                  AS "openCritical",
                count(*) FILTER (WHERE opened_at > now() - interval '30 days')::int AS "opened30d",
                round((avg(EXTRACT(EPOCH FROM resolved_at - opened_at) / 3600)
                  FILTER (WHERE resolved_at IS NOT NULL
                          AND opened_at > now() - interval '30 days'))::numeric, 1)
                  AS "avgResolveHours30d"
         FROM incidents`,
      ),
      this.db.query(
        `SELECT count(*) FILTER (WHERE status NOT IN ('verified', 'cancelled'))::int AS active,
                count(*) FILTER (WHERE status NOT IN ('verified', 'cancelled')
                                 AND priority IN ('urgent', 'high'))::int AS "activeHighPriority",
                count(*) FILTER (WHERE created_at > now() - interval '30 days')::int
                  AS "created30d",
                round((avg(EXTRACT(EPOCH FROM done_at - created_at) / 3600)
                  FILTER (WHERE done_at IS NOT NULL))::numeric, 1) AS "avgCompleteHours"
         FROM work_orders`,
      ),
      this.db.query(
        `SELECT count(*) FILTER (WHERE status IN ('new', 'triaged', 'in_progress'))::int AS open,
                count(*) FILTER (WHERE status = 'new')::int AS untriaged,
                count(*) FILTER (WHERE created_at > now() - interval '30 days')::int
                  AS "received30d",
                round((avg(EXTRACT(EPOCH FROM updated_at - created_at) / 3600)
                  FILTER (WHERE status IN ('resolved', 'closed')))::numeric, 1)
                  AS "avgResolveHours"
         FROM citizen_reports
         WHERE duplicate_of_id IS NULL`,
      ),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      modules: modules.rows,
      incidents: incidents.rows[0],
      workOrders: workOrders.rows[0],
      citizenReports: reports.rows[0],
    };
  }
}

@Controller('analytics')
class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @RequirePermission('platform', 'read')
  @Get('overview')
  overview() {
    return this.analytics.overview();
  }
}

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
