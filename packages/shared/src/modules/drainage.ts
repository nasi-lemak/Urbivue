import { z } from 'zod';
import { registerAssetType } from '../asset-types';

/** Drain Management module (Phase 1): drainage network as lines + nodes. */

registerAssetType({
  id: 'drain_line',
  module: 'drainage',
  name: 'Drain line',
  geometryKind: 'line',
  attributes: z
    .object({
      shape: z.enum(['u_drain', 'box_culvert', 'pipe', 'earth_drain']),
      widthM: z.number().positive().optional(),
      depthM: z.number().positive().optional(),
      material: z.enum(['concrete', 'brick', 'hdpe', 'earth', 'other']).optional(),
      upstreamNodeCode: z.string().optional(),
      downstreamNodeCode: z.string().optional(),
      blockagePct: z.number().min(0).max(100).optional(),
      notes: z.string().optional(),
    })
    .strict(),
  style: { color: '#0891b2' },
});

registerAssetType({
  id: 'drain_node',
  module: 'drainage',
  name: 'Drain node',
  geometryKind: 'point',
  attributes: z
    .object({
      kind: z.enum(['inlet', 'manhole', 'outfall', 'culvert_mouth']),
      invertLevelM: z.number().optional(),
      notes: z.string().optional(),
    })
    .strict(),
  style: { color: '#0e7490', icon: 'circle' },
});
