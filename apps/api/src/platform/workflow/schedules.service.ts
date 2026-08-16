import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DbService } from '../db/db.service';

/** How often the generator sweep runs; generation itself is idempotent. */
const SWEEP_MS = 6 * 60 * 60 * 1000;

export interface ScheduleRunResult {
  key: string;
  name: string;
  created: number;
}

/**
 * Recurring maintenance schedules. Each enabled schedule targets an asset
 * type: every `interval_days`, each active asset of that type gets one
 * preventive work order (skipped while one from this schedule is younger
 * than the interval — the NOT EXISTS below makes re-runs idempotent).
 */
@Injectable()
export class SchedulesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulesService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly db: DbService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.runAll().catch((err) => this.logger.warn(`Schedule sweep failed: ${err}`));
    }, SWEEP_MS);
    // Initial sweep shortly after boot (idempotent, tolerant of missing tables).
    setTimeout(() => {
      this.runAll().catch((err) => this.logger.warn(`Initial schedule sweep failed: ${err}`));
    }, 15_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  list() {
    return this.db
      .query(
        `SELECT s.id, s.module, s.key, s.name, s.asset_type_id AS "assetTypeId",
                s.template_key AS "templateKey", s.interval_days AS "intervalDays",
                s.priority, s.enabled,
                (SELECT count(*)::int FROM work_orders w
                 WHERE w.schedule_id = s.id AND w.status NOT IN ('verified', 'cancelled'))
                  AS "activeWorkOrders"
         FROM schedules s
         ORDER BY s.module, s.key`,
      )
      .then((r) => r.rows);
  }

  async runAll(): Promise<ScheduleRunResult[]> {
    const schedules = await this.db.query<{
      id: string;
      key: string;
      name: string;
      asset_type_id: string;
      template_key: string | null;
      interval_days: number;
      priority: string;
    }>(
      `SELECT id, key, name, asset_type_id, template_key, interval_days, priority
       FROM schedules WHERE enabled`,
    );

    const results: ScheduleRunResult[] = [];
    for (const s of schedules.rows) {
      const inserted = await this.db.query(
        `INSERT INTO work_orders (asset_id, schedule_id, kind, priority, title, description)
         SELECT a.id, $1, 'preventive', $2::work_order_priority,
                $3 || ': ' || a.code,
                'Recurring every ' || $4 || ' days.' ||
                  CASE WHEN $5::text IS NULL THEN ''
                       ELSE ' Use inspection template ''' || $5 || '''.' END
         FROM assets a
         WHERE a.type_id = $6 AND a.status <> 'decommissioned'
           AND NOT EXISTS (
             SELECT 1 FROM work_orders w
             WHERE w.schedule_id = $1 AND w.asset_id = a.id
               AND w.created_at > now() - ($4 || ' days')::interval
           )
         RETURNING id`,
        [s.id, s.priority, s.name, s.interval_days, s.template_key, s.asset_type_id],
      );
      const created = inserted.rowCount ?? 0;
      if (created) this.logger.log(`Schedule '${s.key}' generated ${created} work order(s)`);
      results.push({ key: s.key, name: s.name, created });
    }
    return results;
  }
}
