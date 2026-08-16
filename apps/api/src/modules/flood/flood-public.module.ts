import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { DbService } from '../../platform/db/db.service';
import { Public } from '../../platform/auth/decorators';

/**
 * Public flood status feed: monitoring stations with their latest level
 * classified against the configured warning/danger thresholds, plus the
 * flood-risk zones. Feeds the public portal's advisory banner and map.
 */
@Injectable()
export class FloodPublicService {
  constructor(private readonly db: DbService) {}

  async status() {
    const thresholds = await this.db.query<{ key: string; params: { value: number } }>(
      `SELECT key, params FROM alert_rules
       WHERE key IN ('flood.level_warning', 'flood.level_danger') AND enabled`,
    );
    const warningAt =
      thresholds.rows.find((r) => r.key === 'flood.level_warning')?.params.value ?? 1.5;
    const dangerAt =
      thresholds.rows.find((r) => r.key === 'flood.level_danger')?.params.value ?? 2.5;

    const stations = await this.db.query<{
      code: string;
      name: string;
      level: number | null;
      at: string | null;
      geometry: unknown;
    }>(
      `SELECT a.code, a.name, latest.value AS level, latest.ts AS at,
              ST_AsGeoJSON(a.geom)::json AS geometry
       FROM assets a
       JOIN sensors s ON s.asset_id = a.id AND s.kind = 'water_level'
       LEFT JOIN LATERAL (
         SELECT value, ts FROM readings WHERE sensor_id = s.id ORDER BY ts DESC LIMIT 1
       ) latest ON TRUE
       WHERE a.type_id = 'monitoring_station' AND a.status <> 'decommissioned'
       ORDER BY a.code`,
    );

    const classify = (level: number | null) =>
      level === null
        ? 'no_data'
        : level >= dangerAt
          ? 'danger'
          : level >= warningAt
            ? 'warning'
            : 'normal';

    const zones = await this.db.query(
      `SELECT code, name, attributes->>'riskClass' AS "riskClass",
              ST_AsGeoJSON(geom)::json AS geometry
       FROM assets WHERE type_id = 'flood_zone' AND status <> 'decommissioned'`,
    );

    const stationRows = stations.rows.map((s) => ({ ...s, status: classify(s.level) }));
    const worst = ['danger', 'warning', 'normal', 'no_data'].find((c) =>
      stationRows.some((s) => s.status === c),
    );
    return {
      overall: worst ?? 'no_data',
      thresholds: { warningAt, dangerAt },
      stations: stationRows,
      zones: zones.rows,
    };
  }
}

@Controller('public/flood-status')
class FloodPublicController {
  constructor(private readonly flood: FloodPublicService) {}

  @Public()
  @Get()
  status() {
    return this.flood.status();
  }
}

@Module({
  controllers: [FloodPublicController],
  providers: [FloodPublicService],
})
export class FloodPublicModule {}
