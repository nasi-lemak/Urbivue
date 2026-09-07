import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DbService } from '../../platform/db/db.service';
import { PlatformEventsService } from '../../platform/events/events.service';
import { RulesService } from '../../platform/rules/rules.service';
import { ZonesService } from '../../platform/zones/zones.module';

/** A run-status reading older than this no longer proves the pump is running. */
const RUN_STATUS_FRESH_MINUTES = 15;
/** Run-hours integration: a gap between readings longer than this counts as
 *  the cap, not the gap — a dead reporting link must not accrue run time. */
const RUN_GAP_CAP_MINUTES = 15;
/** Preventive service due after this many run-hours unless the pump's
 *  serviceIntervalHours attribute says otherwise. */
const DEFAULT_SERVICE_INTERVAL_HOURS = 500;
const SERVICE_SWEEP_MS = 60 * 60 * 1000;
/** Stable dedup marker; run-hours detail goes in the description. */
const SERVICE_TITLE_PREFIX = 'Pump service due:';

@Injectable()
export class PumpsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PumpsService.name);
  private serviceTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DbService,
    private readonly events: PlatformEventsService,
    private readonly rules: RulesService,
    private readonly zones: ZonesService,
  ) {}

  onModuleInit() {
    this.serviceTimer = setInterval(() => {
      this.checkServiceDue().catch((err) =>
        this.logger.warn(`Run-hours service sweep failed: ${err}`),
      );
    }, SERVICE_SWEEP_MS);
    // Flood interlock: when a water-level alert opens, verify stations in
    // the affected ward(s) are pumping. A sensor outside any ward falls
    // back to checking every station (small-town mode).
    this.events.onIncidentOpened(async (event) => {
      if (event.module === 'flood' && event.ruleKey?.startsWith('flood.level')) {
        const zoneIds = event.sensorId
          ? await this.zones.zoneIdsForSensor(event.sensorId, 'ward')
          : [];
        await this.checkStationsDuringFlood(event.title, zoneIds);
      }
    });
  }

  onModuleDestroy() {
    if (this.serviceTimer) clearInterval(this.serviceTimer);
  }

  /**
   * Run-hours preventive servicing. Integrates run_status readings (value=1)
   * since the last completed run-hours service work order — each running
   * reading contributes the time to the next reading, capped so reporting
   * gaps don't count as run time. Pumps past their interval get one open
   * preventive work order; completing it resets the clock (the next sweep
   * integrates from its done_at).
   */
  async checkServiceDue(): Promise<{ pump: string; runHours: number; workOrderCode: string }[]> {
    const due = await this.db.query<{
      id: string;
      code: string;
      name: string;
      interval_hours: number;
      run_hours: number;
      since: string | null;
    }>(
      `SELECT p.id, p.code, p.name,
              COALESCE((p.attributes->>'serviceIntervalHours')::numeric, $2) AS interval_hours,
              COALESCE(run.hours, 0) AS run_hours,
              base.done_at AS since
       FROM assets p
       JOIN sensors s ON s.asset_id = p.id AND s.kind = 'run_status'
       LEFT JOIN LATERAL (
         SELECT done_at FROM work_orders
         WHERE asset_id = p.id AND kind = 'preventive' AND done_at IS NOT NULL
           AND status IN ('done', 'verified') AND title LIKE $3 || '%'
         ORDER BY done_at DESC LIMIT 1
       ) base ON TRUE
       LEFT JOIN LATERAL (
         SELECT sum(LEAST(EXTRACT(EPOCH FROM (seq.nxt - seq.ts)), $1 * 60)) / 3600 AS hours
         FROM (
           SELECT r.ts, r.value, lead(r.ts) OVER (ORDER BY r.ts) AS nxt
           FROM readings r
           WHERE r.sensor_id = s.id AND r.quality <> 'bad'
             AND (base.done_at IS NULL OR r.ts > base.done_at)
         ) seq
         WHERE seq.value = 1 AND seq.nxt IS NOT NULL
       ) run ON TRUE
       WHERE p.type_id = 'pump' AND p.status <> 'decommissioned'
         AND COALESCE(run.hours, 0) >=
             COALESCE((p.attributes->>'serviceIntervalHours')::numeric, $2)`,
      [RUN_GAP_CAP_MINUTES, DEFAULT_SERVICE_INTERVAL_HOURS, SERVICE_TITLE_PREFIX],
    );

    const created: { pump: string; runHours: number; workOrderCode: string }[] = [];
    for (const pump of due.rows) {
      const runHours = Math.round(Number(pump.run_hours));
      const wo = await this.db.query<{ code: string }>(
        `INSERT INTO work_orders (asset_id, kind, priority, title, description)
         SELECT $1, 'preventive', 'medium', $2, $3
         WHERE NOT EXISTS (
           SELECT 1 FROM work_orders
           WHERE asset_id = $1 AND kind = 'preventive'
             AND status NOT IN ('verified', 'cancelled') AND title LIKE $4 || '%'
         )
         RETURNING code`,
        [
          pump.id,
          `${SERVICE_TITLE_PREFIX} ${pump.code}`,
          `${pump.name} has run ${runHours} h since ` +
            (pump.since
              ? `its last service on ${new Date(pump.since).toISOString().slice(0, 10)}`
              : 'commissioning') +
            ` (interval: ${Number(pump.interval_hours)} h).`,
          SERVICE_TITLE_PREFIX,
        ],
      );
      if (wo.rowCount) {
        this.logger.log(`Run-hours service WO ${wo.rows[0].code} for ${pump.code} (${runHours} h)`);
        created.push({ pump: pump.code, runHours, workOrderCode: wo.rows[0].code });
      }
    }
    return created;
  }

  /** Stations with their pumps and latest run status — the readiness board. */
  async readiness() {
    const result = await this.db.query(
      `SELECT st.id, st.code, st.name, st.status,
              COALESCE(
                json_agg(
                  json_build_object(
                    'code', p.code, 'name', p.name, 'status', p.status,
                    'running', run.value = 1,
                    'runStatusAt', run.ts
                  ) ORDER BY p.code
                ) FILTER (WHERE p.id IS NOT NULL), '[]'
              ) AS pumps
       FROM assets st
       LEFT JOIN assets p ON p.parent_id = st.id AND p.type_id = 'pump'
       LEFT JOIN LATERAL (
         SELECT r.value, r.ts
         FROM sensors s
         JOIN readings r ON r.sensor_id = s.id
         WHERE s.asset_id = p.id AND s.kind = 'run_status'
         ORDER BY r.ts DESC LIMIT 1
       ) run ON TRUE
       WHERE st.type_id = 'pump_station' AND st.status <> 'decommissioned'
       GROUP BY st.id, st.code, st.name, st.status
       ORDER BY st.code`,
    );
    return result.rows;
  }

  private async checkStationsDuringFlood(triggerTitle: string, zoneIds: string[]): Promise<void> {
    const idle = await this.db.query<{ id: string; code: string; name: string }>(
      `SELECT st.id, st.code, st.name
       FROM assets st
       WHERE st.type_id = 'pump_station' AND st.status = 'active'
         AND (cardinality($2::uuid[]) = 0 OR EXISTS (
           SELECT 1 FROM zones z
           WHERE z.id = ANY($2) AND ST_Intersects(st.geom, z.geom)
         ))
         AND NOT EXISTS (
           SELECT 1
           FROM assets p
           JOIN sensors s ON s.asset_id = p.id AND s.kind = 'run_status'
           JOIN readings r ON r.sensor_id = s.id
           WHERE p.parent_id = st.id
             AND r.ts > now() - ($1 || ' minutes')::interval
             AND r.value = 1
         )`,
      [RUN_STATUS_FRESH_MINUTES, zoneIds],
    );
    for (const station of idle.rows) {
      const opened = await this.rules.openModuleIncident({
        severity: 'critical',
        title: `Pump station ${station.code} idle during flood alert`,
        assetId: station.id,
        detail: { module: 'pumps', trigger: triggerTitle, station: station.name },
      });
      if (opened) {
        this.logger.warn(`Flood interlock: ${station.code} has no pump running`);
      }
    }
  }
}
