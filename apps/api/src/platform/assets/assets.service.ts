import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  GeoJsonFeatureCollection,
  UpdateAssetInput,
  geometryTypeMatches,
  getAssetType,
  validateAttributes,
} from '@urbivue/shared';
import { DbService } from '../db/db.service';
import { featureToAssetInput, validateAssetInput } from './assets.util';

const ASSET_COLUMNS = `
  id, type_id AS "typeId", code, name, status,
  condition_score AS "conditionScore", attributes, parent_id AS "parentId",
  installed_at AS "installedAt", decommissioned_at AS "decommissionedAt",
  ST_AsGeoJSON(geom)::json AS geometry,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export interface ListFilters {
  typeId?: string;
  status?: string;
  bbox?: [number, number, number, number];
  includeDecommissioned?: boolean;
}

interface AssetRow {
  id: string;
  typeId: string;
  code: string;
  name: string;
  status: string;
  conditionScore: number | null;
  attributes: Record<string, unknown>;
  parentId: string | null;
  installedAt: string | null;
  decommissionedAt: string | null;
  geometry: { type: string; coordinates: unknown };
  createdAt: string;
  updatedAt: string;
}

function toFeature(row: AssetRow) {
  const { geometry, ...properties } = row;
  return { type: 'Feature' as const, id: row.id, geometry, properties };
}

@Injectable()
export class AssetsService {
  constructor(private readonly db: DbService) {}

  async list(filters: ListFilters) {
    const [minLon, minLat, maxLon, maxLat] = filters.bbox ?? [null, null, null, null];
    const result = await this.db.query<AssetRow>(
      `SELECT ${ASSET_COLUMNS} FROM assets
       WHERE ($1::text IS NULL OR type_id = $1)
         AND ($2::asset_status IS NULL OR status = $2::asset_status)
         AND ($3::boolean OR status <> 'decommissioned')
         AND ($4::float8 IS NULL
              OR ST_Intersects(geom, ST_MakeEnvelope($4, $5, $6, $7, 4326)))
       ORDER BY created_at DESC
       LIMIT 5000`,
      [
        filters.typeId ?? null,
        filters.status ?? null,
        filters.includeDecommissioned ?? false,
        minLon,
        minLat,
        maxLon,
        maxLat,
      ],
    );
    return { type: 'FeatureCollection' as const, features: result.rows.map(toFeature) };
  }

  async get(id: string) {
    const result = await this.db.query<AssetRow>(
      `SELECT ${ASSET_COLUMNS} FROM assets WHERE id = $1`,
      [id],
    );
    if (!result.rows[0]) throw new NotFoundException(`Asset ${id} not found`);
    return toFeature(result.rows[0]);
  }

  async create(raw: unknown) {
    const parsed = validateAssetInput(raw);
    if (!parsed.ok) {
      throw new BadRequestException({ message: 'Validation failed', errors: parsed.errors });
    }
    const a = parsed.input;
    const result = await this.db.query<AssetRow>(
      `INSERT INTO assets
         (type_id, code, name, geom, status, condition_score, attributes, parent_id, installed_at)
       VALUES
         ($1,
          COALESCE($2, upper(left(md5(gen_random_uuid()::text), 8))),
          $3,
          ST_SetSRID(ST_GeomFromGeoJSON($4), 4326),
          COALESCE($5::asset_status, 'active'), $6, $7, $8, $9)
       RETURNING ${ASSET_COLUMNS}`,
      [
        a.typeId,
        a.code ?? null,
        a.name,
        JSON.stringify(a.geometry),
        a.status ?? null,
        a.conditionScore ?? null,
        JSON.stringify(a.attributes),
        a.parentId ?? null,
        a.installedAt ?? null,
      ],
    );
    return toFeature(result.rows[0]);
  }

  async update(id: string, input: UpdateAssetInput) {
    const existing = await this.get(id);
    const def = getAssetType(existing.properties.typeId);
    if (!def) throw new BadRequestException(`Asset type '${existing.properties.typeId}' unknown`);

    if (input.geometry && !geometryTypeMatches(def.geometryKind, input.geometry.type)) {
      throw new BadRequestException(
        `Geometry '${input.geometry.type}' does not match kind '${def.geometryKind}'`,
      );
    }
    let attributes: Record<string, unknown> | undefined;
    if (input.attributes !== undefined) {
      const validated = validateAttributes(def.id, input.attributes);
      if (!validated.success) {
        throw new BadRequestException({ message: 'Validation failed', errors: validated.errors });
      }
      attributes = validated.data;
    }

    const result = await this.db.query<AssetRow>(
      `UPDATE assets SET
         name = COALESCE($2, name),
         status = COALESCE($3::asset_status, status),
         condition_score = COALESCE($4, condition_score),
         attributes = COALESCE($5, attributes),
         geom = COALESCE(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326), geom),
         parent_id = COALESCE($7, parent_id),
         decommissioned_at = CASE WHEN $3 = 'decommissioned' THEN now()::date
                                  ELSE decommissioned_at END
       WHERE id = $1
       RETURNING ${ASSET_COLUMNS}`,
      [
        id,
        input.name ?? null,
        input.status ?? null,
        input.conditionScore ?? null,
        attributes ? JSON.stringify(attributes) : null,
        input.geometry ? JSON.stringify(input.geometry) : null,
        input.parentId ?? null,
      ],
    );
    return toFeature(result.rows[0]);
  }

  /** Assets are never hard-deleted: decommission keeps history and audit intact. */
  decommission(id: string) {
    return this.update(id, { status: 'decommissioned' });
  }

  async importGeoJson(typeId: string, collection: GeoJsonFeatureCollection, dryRun: boolean) {
    if (!getAssetType(typeId)) {
      throw new BadRequestException(`Unknown asset type '${typeId}'`);
    }
    const errors: { index: number; errors: string[] }[] = [];
    const valid: ReturnType<typeof validateAssetInput>[] = [];

    collection.features.forEach((feature, index) => {
      const parsed = validateAssetInput(featureToAssetInput(typeId, feature));
      if (parsed.ok) valid.push(parsed);
      else errors.push({ index, errors: parsed.errors });
    });

    let imported = 0;
    if (!dryRun && errors.length === 0) {
      await this.db.withTransaction(async (client) => {
        for (const parsed of valid) {
          if (!parsed.ok) continue;
          const a = parsed.input;
          await client.query(
            `INSERT INTO assets (type_id, code, name, geom, status, condition_score, attributes)
             VALUES ($1, COALESCE($2, upper(left(md5(gen_random_uuid()::text), 8))), $3,
                     ST_SetSRID(ST_GeomFromGeoJSON($4), 4326),
                     COALESCE($5::asset_status, 'active'), $6, $7)`,
            [
              a.typeId,
              a.code ?? null,
              a.name,
              JSON.stringify(a.geometry),
              a.status ?? null,
              a.conditionScore ?? null,
              JSON.stringify(a.attributes),
            ],
          );
          imported++;
        }
      });
    }
    return {
      dryRun,
      total: collection.features.length,
      valid: valid.length,
      imported,
      errors,
    };
  }
}
