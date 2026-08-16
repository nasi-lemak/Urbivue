import { z } from 'zod';
import { registerAssetType } from '../asset-types';

/**
 * Traffic Counters module (Phase 3). Deliberately the thinnest module:
 * count ingestion via the telemetry pipeline, analytics + a public data
 * API on top. Device health is covered by an absence rule.
 */

registerAssetType({
  id: 'traffic_counter',
  module: 'traffic',
  name: 'Traffic counter',
  geometryKind: 'point',
  attributes: z
    .object({
      technology: z.enum(['inductive_loop', 'radar', 'camera', 'pneumatic_tube']),
      lanesCovered: z.number().int().positive().optional(),
      directions: z.string().optional(),
      roadName: z.string().optional(),
      notes: z.string().optional(),
    })
    .strict(),
  style: { color: '#374151', icon: 'triangle' },
});
