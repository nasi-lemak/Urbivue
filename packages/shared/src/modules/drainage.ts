import { z } from 'zod';
import { registerAssetType } from '../asset-types';
import { registerInspectionTemplate } from '../workflow';
import { registerReportCategory } from '../reports';

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

/**
 * Drain condition inspection. Submitting one writes blockagePct back to the
 * asset's attributes, and blockage >= 70% auto-opens a cleaning work order
 * (see the drainage hook in the API's InspectionsService).
 */
registerInspectionTemplate({
  key: 'drainage.condition',
  assetTypeId: 'drain_line',
  name: 'Drain condition check',
  items: [
    {
      key: 'blockagePct',
      label: 'Blockage / silt level (%)',
      type: 'number',
      required: true,
      min: 0,
      max: 100,
    },
    {
      key: 'structuralScore',
      label: 'Structural condition (1 failed - 5 excellent)',
      type: 'score',
      required: true,
    },
    { key: 'coversIntact', label: 'Covers/grates intact', type: 'boolean', required: true },
    { key: 'observations', label: 'Observations', type: 'note' },
  ],
});

registerReportCategory({
  key: 'blocked_drain',
  module: 'drainage',
  name: 'Blocked drain',
  priority: 'high',
});
registerReportCategory({
  key: 'damaged_drain_cover',
  module: 'drainage',
  name: 'Broken or missing drain cover',
  priority: 'high',
});
