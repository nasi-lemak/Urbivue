import { describe, expect, it } from 'vitest';
import { geometryTypeMatches, getAssetType, validateAttributes } from '../src/asset-types';

describe('asset type registry', () => {
  it('registers the built-in demo types', () => {
    expect(getAssetType('demo_poi')?.geometryKind).toBe('point');
    expect(getAssetType('demo_area')?.geometryKind).toBe('polygon');
  });

  it('validates attributes against the type schema', () => {
    expect(validateAttributes('demo_poi', { category: 'fountain' }).success).toBe(true);

    const missing = validateAttributes('demo_poi', {});
    expect(missing.success).toBe(false);

    const extraKey = validateAttributes('demo_poi', { category: 'x', bogus: 1 });
    expect(extraKey.success).toBe(false);
  });

  it('rejects unknown asset types', () => {
    const result = validateAttributes('nope', {});
    expect(result.success).toBe(false);
  });

  it('matches geometry kinds to GeoJSON types', () => {
    expect(geometryTypeMatches('point', 'Point')).toBe(true);
    expect(geometryTypeMatches('point', 'Polygon')).toBe(false);
    expect(geometryTypeMatches('polygon', 'MultiPolygon')).toBe(true);
    expect(geometryTypeMatches('line', 'LineString')).toBe(true);
  });
});
