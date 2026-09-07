import { Controller, Get, Header, Module, Req, UnauthorizedException } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { DbService } from '../db/db.service';
import { Public } from '../auth/decorators';
import { counters } from './counters';

const BOOTED_AT = Date.now();

function line(name: string, value: number | string, labels?: Record<string, string>): string {
  const labelStr = labels
    ? `{${Object.entries(labels)
        .map(([k, v]) => `${k}="${v.replace(/(["\\])/g, '\\$1')}"`)
        .join(',')}}`
    : '';
  return `${name}${labelStr} ${value}`;
}

/**
 * Prometheus text-format metrics (`GET /api/metrics`). Unauthenticated by
 * default for internal scrapers; set METRICS_TOKEN to require
 * `Authorization: Bearer <token>` (Prometheus `bearer_token` config) when the
 * API is reachable from outside the scrape network.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(@Req() req: { headers: Record<string, string | undefined> }): Promise<string> {
    const token = process.env.METRICS_TOKEN;
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      throw new UnauthorizedException('Metrics token required');
    }

    const out: string[] = [];
    const push = (name: string, help: string, type: 'gauge' | 'counter', rows: string[]) => {
      out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, ...rows);
    };

    let dbUp = 1;
    try {
      const [incidents, sensors, workOrders, reports, assets] = await Promise.all([
        this.db.query<{ severity: string; count: number }>(
          `SELECT severity::text, count(*)::int AS count FROM incidents
           WHERE status <> 'resolved' GROUP BY severity`,
        ),
        this.db.query<{ total: number; stale: number; revoked: number }>(
          `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE last_seen_at IS NULL
                                   OR last_seen_at < now() - interval '2 hours')::int AS stale,
                  count(*) FILTER (WHERE key_revoked_at IS NOT NULL)::int AS revoked
           FROM sensors`,
        ),
        this.db.query<{ status: string; count: number }>(
          `SELECT status::text, count(*)::int AS count FROM work_orders
           WHERE status NOT IN ('verified', 'cancelled') GROUP BY status`,
        ),
        this.db.query<{ open: number; untriaged: number }>(
          `SELECT count(*) FILTER (WHERE status IN ('new', 'triaged', 'in_progress'))::int AS open,
                  count(*) FILTER (WHERE status = 'new')::int AS untriaged
           FROM citizen_reports WHERE duplicate_of_id IS NULL`,
        ),
        this.db.query<{ module: string; count: number }>(
          `SELECT t.module, count(*)::int AS count FROM assets a
           JOIN asset_types t ON t.id = a.type_id
           WHERE a.status <> 'decommissioned' GROUP BY t.module`,
        ),
      ]);

      push(
        'urbivue_incidents_open',
        'Unresolved incidents by severity',
        'gauge',
        ['info', 'warning', 'critical'].map((severity) =>
          line(
            'urbivue_incidents_open',
            incidents.rows.find((r) => r.severity === severity)?.count ?? 0,
            {
              severity,
            },
          ),
        ),
      );
      push('urbivue_sensors_total', 'Registered sensors', 'gauge', [
        line('urbivue_sensors_total', sensors.rows[0].total),
      ]);
      push('urbivue_sensors_stale', 'Sensors silent for over 2 hours (or never seen)', 'gauge', [
        line('urbivue_sensors_stale', sensors.rows[0].stale),
      ]);
      push('urbivue_sensors_revoked', 'Sensors with revoked device keys', 'gauge', [
        line('urbivue_sensors_revoked', sensors.rows[0].revoked),
      ]);
      push(
        'urbivue_work_orders_active',
        'Work orders not yet verified/cancelled, by status',
        'gauge',
        workOrders.rows.map((r) =>
          line('urbivue_work_orders_active', r.count, { status: r.status }),
        ),
      );
      push('urbivue_citizen_reports_open', 'Citizen reports still open', 'gauge', [
        line('urbivue_citizen_reports_open', reports.rows[0].open),
      ]);
      push('urbivue_citizen_reports_untriaged', 'Citizen reports awaiting triage', 'gauge', [
        line('urbivue_citizen_reports_untriaged', reports.rows[0].untriaged),
      ]);
      push(
        'urbivue_assets',
        'Active assets by module',
        'gauge',
        assets.rows.map((r) => line('urbivue_assets', r.count, { module: r.module })),
      );
    } catch {
      dbUp = 0;
    }

    push('urbivue_db_up', 'Database reachability (1 = up)', 'gauge', [line('urbivue_db_up', dbUp)]);
    push('urbivue_readings_ingested_total', 'Readings accepted since process start', 'counter', [
      line('urbivue_readings_ingested_total', counters.readingsAccepted),
    ]);
    push('urbivue_readings_rejected_total', 'Readings rejected since process start', 'counter', [
      line('urbivue_readings_rejected_total', counters.readingsRejected),
    ]);
    push(
      'urbivue_notifications_sent_total',
      'Alert notifications dispatched since process start',
      'counter',
      [line('urbivue_notifications_sent_total', counters.notificationsSent)],
    );
    push('process_uptime_seconds', 'Seconds since API start', 'gauge', [
      line('process_uptime_seconds', Math.round((Date.now() - BOOTED_AT) / 1000)),
    ]);
    push('process_resident_memory_bytes', 'Resident set size', 'gauge', [
      line('process_resident_memory_bytes', process.memoryUsage.rss()),
    ]);

    return out.join('\n') + '\n';
  }
}

@Module({ imports: [DbModule], controllers: [MetricsController] })
export class MetricsModule {}
