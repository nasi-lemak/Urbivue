import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { SENSOR_KINDS } from '@urbivue/shared';
import { z } from 'zod';
import { DbService } from '../db/db.service';
import { RequirePermission } from '../auth/decorators';
import { zodParse } from '../zod';

/** Device provisioning payload (see docs/HARDWARE.md for the workflow). */
const createSensorSchema = z.object({
  externalId: z.string().min(1).max(64),
  kind: z.enum(SENSOR_KINDS),
  unit: z.string().max(16),
  /** Attach to an asset by its code; sensor inherits the asset's location. */
  assetCode: z.string().optional(),
  /** Standalone sensors (e.g. a lone rain gauge) give coordinates instead. */
  location: z
    .object({ lon: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) })
    .optional(),
  config: z.record(z.unknown()).optional(),
});

@Controller('sensors')
export class SensorsController {
  constructor(private readonly db: DbService) {}

  @RequirePermission('platform', 'manage')
  @Post()
  async register(@Body() body: unknown) {
    const input = zodParse(createSensorSchema, body);

    let assetId: string | null = null;
    if (input.assetCode) {
      const asset = await this.db.query<{ id: string }>('SELECT id FROM assets WHERE code = $1', [
        input.assetCode,
      ]);
      if (!asset.rows[0]) throw new BadRequestException(`Unknown asset code '${input.assetCode}'`);
      assetId = asset.rows[0].id;
    } else if (!input.location) {
      throw new BadRequestException('Provide assetCode or location');
    }

    try {
      const result = await this.db.query<{ id: string }>(
        `INSERT INTO sensors (asset_id, kind, external_id, unit, geom, config)
         VALUES ($1, $2, $3, $4,
                 COALESCE(
                   ST_SetSRID(ST_MakePoint($5, $6), 4326),
                   (SELECT ST_PointOnSurface(geom) FROM assets WHERE id = $1)
                 ),
                 $7)
         RETURNING id`,
        [
          assetId,
          input.kind,
          input.externalId,
          input.unit,
          input.location?.lon ?? null,
          input.location?.lat ?? null,
          JSON.stringify(input.config ?? {}),
        ],
      );
      return {
        id: result.rows[0].id,
        externalId: input.externalId,
        mqttTopic: `urbivue/ingest/${input.externalId}`,
      };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(`Sensor '${input.externalId}' already exists`);
      }
      throw err;
    }
  }

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
