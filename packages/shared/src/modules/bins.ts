import { z } from 'zod';
import { registerAssetType } from '../asset-types';
import { registerReportCategory } from '../reports';

/**
 * Waste Bins module (Phase 3). Bins with ultrasonic fill sensors report
 * levels; unsensored bins rely on citizen reports and route history.
 */

registerAssetType({
  id: 'waste_bin',
  module: 'bins',
  name: 'Waste bin',
  geometryKind: 'point',
  attributes: z
    .object({
      capacityL: z.number().positive(),
      stream: z.enum(['general', 'recycling', 'organic']),
      binType: z.enum(['street', 'communal', 'underground']).optional(),
      routeId: z.string().optional(),
      notes: z.string().optional(),
    })
    .strict(),
  style: { color: '#4b5563', icon: 'square' },
});

registerReportCategory({
  key: 'overflowing_bin',
  module: 'bins',
  name: 'Overflowing bin',
  priority: 'high',
});
registerReportCategory({
  key: 'illegal_dumping',
  module: 'bins',
  name: 'Illegal dumping',
  priority: 'medium',
});
