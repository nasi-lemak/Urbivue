import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DbService } from '../../platform/db/db.service';
import { PlatformEventsService } from '../../platform/events/events.service';
import { RulesService } from '../../platform/rules/rules.service';

/** A run-status reading older than this no longer proves the pump is running. */
const RUN_STATUS_FRESH_MINUTES = 15;

@Injectable()
export class PumpsService implements OnModuleInit {
  private readonly logger = new Logger(PumpsService.name);

  constructor(
    private readonly db: DbService,
    private readonly events: PlatformEventsService,
    private readonly rules: RulesService,
  ) {}

  onModuleInit() {
    // Flood interlock: when a water-level alert opens, verify stations are
    // pumping. Zone-scoping comes with the zones entity; until then every
    // station is checked (acceptable at municipal station counts).
    this.events.onIncidentOpened(async (event) => {
      if (event.module === 'flood' && event.ruleKey?.startsWith('flood.level')) {
        await this.checkStationsDuringFlood(event.title);
      }
    });
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

  private async checkStationsDuringFlood(triggerTitle: string): Promise<void> {
    const idle = await this.db.query<{ id: string; code: string; name: string }>(
      `SELECT st.id, st.code, st.name
       FROM assets st
       WHERE st.type_id = 'pump_station' AND st.status = 'active'
         AND NOT EXISTS (
           SELECT 1
           FROM assets p
           JOIN sensors s ON s.asset_id = p.id AND s.kind = 'run_status'
           JOIN readings r ON r.sensor_id = s.id
           WHERE p.parent_id = st.id
             AND r.ts > now() - ($1 || ' minutes')::interval
             AND r.value = 1
         )`,
      [RUN_STATUS_FRESH_MINUTES],
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
