import { z } from 'zod';

export const GEOMETRY_KINDS = ['point', 'line', 'polygon'] as const;
export type GeometryKind = (typeof GEOMETRY_KINDS)[number];

export const ASSET_STATUSES = [
  'active',
  'needs_attention',
  'under_maintenance',
  'out_of_service',
  'decommissioned',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export interface AssetTypeStyle {
  /** Hex color used for map rendering of this asset type. */
  color: string;
  icon?: string;
}

export interface AssetTypeDefinition {
  id: string;
  /** Owning module key, e.g. 'drainage', 'flood'. 'demo' for the built-in demo types. */
  module: string;
  name: string;
  geometryKind: GeometryKind;
  /** Zod schema validating the JSONB attributes blob for assets of this type. */
  attributes: z.ZodTypeAny;
  style: AssetTypeStyle;
}

const registry = new Map<string, AssetTypeDefinition>();

export function registerAssetType(def: AssetTypeDefinition): void {
  if (registry.has(def.id)) {
    throw new Error(`Asset type '${def.id}' is already registered`);
  }
  registry.set(def.id, def);
}

export function getAssetType(id: string): AssetTypeDefinition | undefined {
  return registry.get(id);
}

export function listAssetTypes(): AssetTypeDefinition[] {
  return [...registry.values()];
}

export type AttributeValidation =
  { success: true; data: Record<string, unknown> } | { success: false; errors: string[] };

export function validateAttributes(typeId: string, attributes: unknown): AttributeValidation {
  const def = registry.get(typeId);
  if (!def) return { success: false, errors: [`Unknown asset type '${typeId}'`] };
  const result = def.attributes.safeParse(attributes ?? {});
  if (result.success) return { success: true, data: result.data as Record<string, unknown> };
  return {
    success: false,
    errors: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

/** GeoJSON geometry types acceptable for each geometry kind. */
const KIND_TO_GEOJSON: Record<GeometryKind, readonly string[]> = {
  point: ['Point', 'MultiPoint'],
  line: ['LineString', 'MultiLineString'],
  polygon: ['Polygon', 'MultiPolygon'],
};

export function geometryTypeMatches(kind: GeometryKind, geojsonType: string): boolean {
  return KIND_TO_GEOJSON[kind].includes(geojsonType);
}

// ---------------------------------------------------------------------------
// Built-in demo asset types (module 'demo'). Domain modules register their own
// types the same way from Phase 1 onward.
// ---------------------------------------------------------------------------

registerAssetType({
  id: 'demo_poi',
  module: 'demo',
  name: 'Point of interest',
  geometryKind: 'point',
  attributes: z
    .object({
      category: z.string().min(1),
      notes: z.string().optional(),
    })
    .strict(),
  style: { color: '#2563eb', icon: 'marker' },
});

registerAssetType({
  id: 'demo_area',
  module: 'demo',
  name: 'Managed area',
  geometryKind: 'polygon',
  attributes: z
    .object({
      kind: z.enum(['park', 'reserve', 'depot', 'other']),
      notes: z.string().optional(),
    })
    .strict(),
  style: { color: '#16a34a' },
});
