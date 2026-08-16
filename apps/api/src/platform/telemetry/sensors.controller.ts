import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { RequirePermission } from '../auth/decorators';

@Controller('sensors')
export class SensorsController {
  constructor(private readonly db: DbService) {}

  @RequirePermission('platform', 'read')
  @Get()
  async list(@Query('kind') kind?: string) {
    const result = await this.db.query(
      `SELECT s.id, s.external_id AS "externalId", s.kind, s.unit,
              s.asset_id AS "assetId", s.last_seen_at AS "lastSeenAt",
              ST_AsGeoJSON(s.geom)::json AS geometry,
              latest.value AS "lastValue", latest.ts AS "lastTs"
       FROM sensors s
       LEFT JOIN LATERAL (
         SELECT value, ts FROM readings WHERE sensor_id = s.id ORDER BY ts DESC LIMIT 1
       ) latest ON TRUE
       WHERE $1::text IS NULL OR s.kind = $1
       ORDER BY s.external_id`,
      [kind ?? null],
    );
    return result.rows;
  }

  @RequirePermission('platform', 'read')
  @Get(':id/readings')
  async readings(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('bucket') bucket?: string,
  ) {
    const max = Math.min(Number(limit ?? 500), 5000);
    if (Number.isNaN(max) || max < 1) throw new BadRequestException('Invalid limit');

    if (bucket) {
      // Portable aggregation (works without TimescaleDB); a continuous
      // aggregate can replace this query shape when chart volume demands it.
      if (!['hour', 'day'].includes(bucket)) {
        throw new BadRequestException(`bucket must be 'hour' or 'day'`);
      }
      const result = await this.db.query(
        `SELECT date_trunc($5, ts) AS ts,
                avg(value) AS avg, min(value) AS min, max(value) AS max, count(*)::int AS count
         FROM readings
         WHERE sensor_id = $1
           AND ($2::timestamptz IS NULL OR ts >= $2)
           AND ($3::timestamptz IS NULL OR ts <= $3)
         GROUP BY 1 ORDER BY 1 DESC LIMIT $4`,
        [id, from ?? null, to ?? null, max, bucket],
      );
      return result.rows;
    }

    const result = await this.db.query(
      `SELECT ts, value, quality FROM readings
       WHERE sensor_id = $1
         AND ($2::timestamptz IS NULL OR ts >= $2)
         AND ($3::timestamptz IS NULL OR ts <= $3)
       ORDER BY ts DESC
       LIMIT $4`,
      [id, from ?? null, to ?? null, max],
    );
    return result.rows;
  }
}
