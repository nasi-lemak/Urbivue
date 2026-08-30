import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { DbService } from '../db/db.service';
import { RequirePermission } from '../auth/decorators';
import { zodParse } from '../zod';

const ZONE_KINDS = ['ward', 'catchment', 'collection_route', 'custom'] as const;

const createZoneSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(200),
  kind: z.enum(ZONE_KINDS),
  geometry: z.object({
    type: z.enum(['Polygon', 'MultiPolygon']),
    coordinates: z.any(),
  }),
  attributes: z.record(z.unknown()).optional(),
});

@Injectable()
export class ZonesService {
  constructor(private readonly db: DbService) {}

  list(kind?: string) {
    return this.db
      .query(
        `SELECT id, code, name, kind, attributes,
                ST_AsGeoJSON(geom)::json AS geometry
         FROM zones
         WHERE $1::text IS NULL OR kind = $1
         ORDER BY code`,
        [kind ?? null],
      )
      .then((r) => r.rows);
  }

  async create(input: z.infer<typeof createZoneSchema>) {
    try {
      const result = await this.db.query<{ id: string }>(
        `INSERT INTO zones (code, name, kind, geom, attributes)
         VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326), $5)
         RETURNING id`,
        [
          input.code,
          input.name,
          input.kind,
          JSON.stringify(input.geometry),
          JSON.stringify(input.attributes ?? {}),
        ],
      );
      return { id: result.rows[0].id, code: input.code };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') throw new ConflictException(`Zone '${input.code}' already exists`);
      if (code === '23514') throw new BadRequestException('Geometry must be a (Multi)Polygon');
      throw err;
    }
  }

  async assetsInZone(zoneId: string) {
    const zone = await this.db.query('SELECT 1 FROM zones WHERE id = $1', [zoneId]);
    if (!zone.rowCount) throw new NotFoundException(`Zone ${zoneId} not found`);
    const result = await this.db.query(
      `SELECT a.id, a.code, a.name, a.type_id AS "typeId", a.status, t.module
       FROM assets a
       JOIN asset_types t ON t.id = a.type_id
       JOIN zones z ON z.id = $1
       WHERE a.status <> 'decommissioned' AND ST_Intersects(a.geom, z.geom)
       ORDER BY t.module, a.code`,
      [zoneId],
    );
    return result.rows;
  }

  /** Zone ids (of a kind) containing a sensor's location. */
  async zoneIdsForSensor(sensorId: string, kind = 'ward'): Promise<string[]> {
    const result = await this.db.query<{ id: string }>(
      `SELECT z.id FROM zones z
       JOIN sensors s ON s.id = $1
       WHERE z.kind = $2 AND s.geom IS NOT NULL AND ST_Intersects(s.geom, z.geom)`,
      [sensorId, kind],
    );
    return result.rows.map((r) => r.id);
  }
}

@Controller('zones')
export class ZonesController {
  constructor(private readonly zones: ZonesService) {}

  @RequirePermission('platform', 'read')
  @Get()
  list(@Query('kind') kind?: string) {
    return this.zones.list(kind);
  }

  @RequirePermission('platform', 'manage')
  @Post()
  create(@Body() body: unknown) {
    return this.zones.create(zodParse(createZoneSchema, body));
  }

  @RequirePermission('platform', 'read')
  @Get(':id/assets')
  assets(@Param('id', ParseUUIDPipe) id: string) {
    return this.zones.assetsInZone(id);
  }
}

@Module({
  controllers: [ZonesController],
  providers: [ZonesService],
  exports: [ZonesService],
})
export class ZonesModule {}
