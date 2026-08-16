import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RateOfChangeParams, Severity, ThresholdParams } from '@urbivue/shared';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { evaluateRateOfChange, evaluateThreshold } from './rules.logic';

export interface SensorRow {
  id: string;
  asset_id: string | null;
  kind: string;
  external_id: string;
  unit: string;
}

interface RuleRow {
  id: string;
  module: string;
  key: string;
  name: string;
  kind: 'threshold' | 'rate_of_change' | 'absence';
  sensor_kind: string;
  params: Record<string, unknown>;
  severity: Severity;
}

const RULE_CACHE_MS = 30_000;
const ABSENCE_SWEEP_MS = 60_000;

@Injectable()
export class RulesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RulesService.name);
  private ruleCache: { at: number; rules: RuleRow[] } | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.sweepTimer = setInterval(() => {
      this.sweepAbsences().catch((err) => this.logger.warn(`Absence sweep failed: ${err}`));
    }, ABSENCE_SWEEP_MS);
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  private async enabledRules(): Promise<RuleRow[]> {
    if (this.ruleCache && Date.now() - this.ruleCache.at < RULE_CACHE_MS) {
      return this.ruleCache.rules;
    }
    const result = await this.db.query<RuleRow>(
      'SELECT id, module, key, name, kind, sensor_kind, params, severity FROM alert_rules WHERE enabled',
    );
    this.ruleCache = { at: Date.now(), rules: result.rows };
    return result.rows;
  }

  /** Called by the ingest pipeline for every accepted reading. */
  async evaluateReading(sensor: SensorRow, value: number, ts: Date): Promise<void> {
    const rules = (await this.enabledRules()).filter((r) => r.sensor_kind === sensor.kind);
    for (const rule of rules) {
      try {
        if (rule.kind === 'threshold') {
          const params = rule.params as unknown as ThresholdParams;
          const outcome = evaluateThreshold(params, value);
          if (outcome === 'breach') {
            await this.openIncident(rule, sensor, value, ts);
          } else if (outcome === 'clear') {
            await this.autoResolve(rule.id, sensor.id);
          }
        } else if (rule.kind === 'rate_of_change') {
          const params = rule.params as unknown as RateOfChangeParams;
          const base = await this.db.query<{ value: number }>(
            `SELECT value FROM readings
             WHERE sensor_id = $1 AND ts >= $2::timestamptz - ($3 || ' minutes')::interval
             ORDER BY ts ASC LIMIT 1`,
            [sensor.id, ts.toISOString(), params.windowMinutes],
          );
          const baseline = base.rows[0]?.value;
          if (baseline === undefined) continue;
          if (evaluateRateOfChange(params.delta, baseline, value)) {
            await this.openIncident(rule, sensor, value, ts, { baseline });
          } else {
            await this.autoResolve(rule.id, sensor.id);
          }
        }
        // 'absence' rules are handled by the periodic sweep.
      } catch (err) {
        this.logger.error(`Rule ${rule.key} failed for ${sensor.external_id}: ${err}`);
      }
    }
  }

  /** Re-open path for silent sensors; resolves automatically on next reading. */
  async sweepAbsences(): Promise<void> {
    const result = await this.db.query<{
      rule_id: string;
      sensor_id: string;
      minutes: number;
      [k: string]: unknown;
    }>(
      `SELECT r.id AS rule_id, r.name, r.severity, r.module,
              s.id AS sensor_id, s.asset_id, s.external_id, s.last_seen_at,
              (r.params->>'minutes')::numeric AS minutes
       FROM alert_rules r
       JOIN sensors s ON s.kind = r.sensor_kind
       WHERE r.enabled AND r.kind = 'absence'
         AND s.last_seen_at IS NOT NULL
         AND s.last_seen_at < now() - ((r.params->>'minutes') || ' minutes')::interval`,
    );
    for (const row of result.rows) {
      await this.db.query(
        `INSERT INTO incidents (rule_id, sensor_id, asset_id, severity, title, detail)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (rule_id, sensor_id) WHERE status <> 'resolved' DO NOTHING`,
        [
          row.rule_id,
          row.sensor_id,
          row.asset_id,
          row.severity,
          `${row.name}: ${row.external_id} silent for over ${row.minutes} min`,
          JSON.stringify({ lastSeenAt: row.last_seen_at }),
        ],
      );
    }
  }

  /** Called by ingest when a reading arrives: silence incidents self-heal. */
  async resolveAbsenceIncidents(sensorId: string): Promise<void> {
    await this.db.query(
      `UPDATE incidents SET status = 'resolved', resolved_at = now()
       WHERE sensor_id = $1 AND status <> 'resolved'
         AND rule_id IN (SELECT id FROM alert_rules WHERE kind = 'absence')`,
      [sensorId],
    );
  }

  private async openIncident(
    rule: RuleRow,
    sensor: SensorRow,
    value: number,
    ts: Date,
    extraDetail: Record<string, unknown> = {},
  ): Promise<void> {
    const title = `${rule.name}: ${sensor.external_id} at ${value}${sensor.unit}`;
    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO incidents (rule_id, sensor_id, asset_id, severity, title, detail)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (rule_id, sensor_id) WHERE status <> 'resolved' DO NOTHING
       RETURNING id`,
      [
        rule.id,
        sensor.id,
        sensor.asset_id,
        rule.severity,
        title,
        JSON.stringify({ value, ts: ts.toISOString(), ruleKey: rule.key, ...extraDetail }),
      ],
    );
    if (inserted.rowCount) {
      this.notifications.notify(rule.severity, title, { ruleKey: rule.key, module: rule.module });
    }
  }

  private async autoResolve(ruleId: string, sensorId: string): Promise<void> {
    await this.db.query(
      `UPDATE incidents SET status = 'resolved', resolved_at = now()
       WHERE rule_id = $1 AND sensor_id = $2 AND status <> 'resolved'`,
      [ruleId, sensorId],
    );
  }
}
