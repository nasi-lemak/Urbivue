import { describe, expect, it } from 'vitest';
import { orderByNearestNeighbor } from '../src/modules/bins/bins.module';

const bin = (code: string, lon: number, lat: number) =>
  ({
    id: code,
    code,
    name: code,
    stream: 'general',
    capacityL: 240,
    fillPct: 90,
    fillAt: '',
    lon,
    lat,
  }) as any;

describe('orderByNearestNeighbor', () => {
  it('visits bins in nearest-first order from the depot', () => {
    const bins = [bin('FAR', 101.71, 3.16), bin('NEAR', 101.691, 3.141), bin('MID', 101.7, 3.15)];
    const ordered = orderByNearestNeighbor(bins, 101.69, 3.14);
    expect(ordered.map((b) => b.code)).toEqual(['NEAR', 'MID', 'FAR']);
    expect(ordered[0].legM).toBeGreaterThan(0);
  });

  it('handles an empty list', () => {
    expect(orderByNearestNeighbor([], 101.69, 3.14)).toEqual([]);
  });
});
