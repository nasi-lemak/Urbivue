import { z } from 'zod';
import { ASSET_STATUSES } from './asset-types';

export const geoJsonGeometrySchema = z.object({
  type: z.enum(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']),
  coordinates: z.any(),
});
export type GeoJsonGeometry = z.infer<typeof geoJsonGeometrySchema>;

export const createAssetSchema = z.object({
  typeId: z.string().min(1),
  code: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200),
  geometry: geoJsonGeometrySchema,
  status: z.enum(ASSET_STATUSES).optional(),
  conditionScore: z.number().int().min(1).max(5).nullish(),
  attributes: z.record(z.unknown()).default({}),
  parentId: z.string().uuid().nullish(),
  installedAt: z.string().date().nullish(),
});
export type CreateAssetInput = z.infer<typeof createAssetSchema>;

export const updateAssetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  geometry: geoJsonGeometrySchema.optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  conditionScore: z.number().int().min(1).max(5).nullish(),
  attributes: z.record(z.unknown()).optional(),
  parentId: z.string().uuid().nullish(),
});
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

export const geoJsonFeatureSchema = z.object({
  type: z.literal('Feature'),
  geometry: geoJsonGeometrySchema,
  properties: z.record(z.unknown()).nullable().default({}),
});
export type GeoJsonFeature = z.infer<typeof geoJsonFeatureSchema>;

export const geoJsonFeatureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(geoJsonFeatureSchema),
});
export type GeoJsonFeatureCollection = z.infer<typeof geoJsonFeatureCollectionSchema>;
