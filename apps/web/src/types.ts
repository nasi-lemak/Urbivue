export interface AssetTypeInfo {
  id: string;
  module: string;
  name: string;
  geometryKind: 'point' | 'line' | 'polygon';
  style: { color: string; icon?: string };
}

export interface AssetProperties {
  id: string;
  typeId: string;
  code: string;
  name: string;
  status: string;
  conditionScore: number | null;
  attributes: Record<string, unknown>;
  updatedAt: string;
}

export interface AssetFeature {
  type: 'Feature';
  id: string;
  geometry: { type: string; coordinates: unknown };
  properties: AssetProperties;
}

export interface FeatureCollection {
  type: 'FeatureCollection';
  features: AssetFeature[];
}
