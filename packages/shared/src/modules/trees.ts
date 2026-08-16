import { z } from 'zod';
import { registerAssetType } from '../asset-types';
import { registerInspectionTemplate } from '../workflow';
import { registerReportCategory } from '../reports';

/** Tree Management module (Phase 4): urban tree inventory with risk focus. */

registerAssetType({
  id: 'tree',
  module: 'trees',
  name: 'Tree',
  geometryKind: 'point',
  attributes: z
    .object({
      species: z.string().min(1),
      heightM: z.number().positive().optional(),
      dbhCm: z.number().positive().optional(),
      canopyRadiusM: z.number().positive().optional(),
      plantedYear: z.number().int().min(1800).optional(),
      healthRating: z.number().int().min(1).max(5).optional(),
      riskRating: z.enum(['low', 'medium', 'high']).optional(),
      notes: z.string().optional(),
    })
    .strict(),
  style: { color: '#15803d', icon: 'circle' },
});

/**
 * Arborist risk assessment. The trees hook derives healthRating and
 * riskRating from the responses; a high-risk outcome auto-opens an
 * arborist work order (see InspectionsService).
 */
registerInspectionTemplate({
  key: 'trees.risk_assessment',
  assetTypeId: 'tree',
  name: 'Tree risk assessment',
  items: [
    { key: 'healthScore', label: 'Health (1 dying - 5 excellent)', type: 'score', required: true },
    { key: 'deadwood', label: 'Significant deadwood', type: 'boolean', required: true },
    { key: 'cavities', label: 'Trunk cavities / decay', type: 'boolean', required: true },
    { key: 'rootDamage', label: 'Root damage / heave', type: 'boolean', required: true },
    { key: 'leanChange', label: 'New or increased lean', type: 'boolean', required: true },
    { key: 'observations', label: 'Observations', type: 'note' },
  ],
});

registerReportCategory({
  key: 'fallen_tree',
  module: 'trees',
  name: 'Fallen tree or branch',
  priority: 'urgent',
});
registerReportCategory({
  key: 'dangerous_tree',
  module: 'trees',
  name: 'Tree looks dangerous',
  priority: 'high',
});
registerReportCategory({
  key: 'request_pruning',
  module: 'trees',
  name: 'Request pruning',
  priority: 'low',
});
