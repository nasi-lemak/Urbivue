import { z } from 'zod';
import { registerAssetType } from '../asset-types';

/** Flood Monitoring module (Phase 1): risk zones + monitoring stations. */

registerAssetType({
  id: 'flood_zone',
  module: 'flood',
  name: 'Flood zone',
  geometryKind: 'polygon',
  attributes: z
    .object({
      riskClass: z.enum(['low', 'medium', 'high']),
      basis: z.enum(['historical', 'model', 'expert']).optional(),
      evacNotes: z.string().optional(),
    })
    .strict(),
  style: { color: '#dc2626' },
});

registerAssetType({
  id: 'monitoring_station',
  module: 'flood',
  name: 'Monitoring station',
  geometryKind: 'point',
  attributes: z
    .object({
      stationKind: z.enum(['water_level', 'rainfall', 'combined']),
      waterway: z.string().optional(),
      notes: z.string().optional(),
    })
    .strict(),
  style: { color: '#7c3aed', icon: 'triangle' },
});
