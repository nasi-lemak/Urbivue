import { describe, expect, it } from 'vitest';
import { featureToAssetInput, validateAssetInput } from '../src/platform/assets/assets.util';

const point = { type: 'Point', coordinates: [101.69, 3.14] };

describe('validateAssetInput', () => {
  it('accepts a valid demo_poi payload', () => {
    const result = validateAssetInput({
      typeId: 'demo_poi',
      name: 'Fountain',
      geometry: point,
      attributes: { category: 'fountain' },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects unknown types, bad geometry kinds, and bad attributes', () => {
    expect(
      validateAssetInput({ typeId: 'nope', name: 'x', geometry: point, attributes: {} }).ok,
    ).toBe(false);

    const wrongGeom = validateAssetInput({
      typeId: 'demo_poi',
      name: 'x',
      geometry: { type: 'Polygon', coordinates: [] },
      attributes: { category: 'y' },
    });
    expect(wrongGeom.ok).toBe(false);

    const badAttrs = validateAssetInput({
      typeId: 'demo_poi',
      name: 'x',
      geometry: point,
      attributes: {},
    });
    expect(badAttrs.ok).toBe(false);
  });
});

describe('featureToAssetInput', () => {
  it('lifts known properties and keeps the rest as attributes', () => {
    const input = featureToAssetInput('demo_poi', {
      type: 'Feature',
      geometry: point as never,
      properties: { name: 'Kiosk', code: 'K-1', category: 'kiosk', notes: 'n' },
    });
    const parsed = validateAssetInput(input);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.input.name).toBe('Kiosk');
      expect(parsed.input.code).toBe('K-1');
      expect(parsed.input.attributes).toEqual({ category: 'kiosk', notes: 'n' });
    }
  });
});
