import { z } from 'zod';
import { registerAssetType } from '../asset-types';
import { registerInspectionTemplate } from '../workflow';
import { registerReportCategory } from '../reports';

/** Slope Monitoring module (Phase 2): engineered/natural slopes, landslide risk. */

registerAssetType({
  id: 'slope',
  module: 'slopes',
  name: 'Slope',
  geometryKind: 'polygon',
  attributes: z
    .object({
      heightM: z.number().positive().optional(),
      angleDeg: z.number().min(0).max(90).optional(),
      riskRanking: z.enum(['low', 'medium', 'high']),
      geology: z.string().optional(),
      drainageProvisions: z.string().optional(),
      lastGeotechReport: z.string().optional(),
    })
    .strict(),
  style: { color: '#a16207' },
});

registerInspectionTemplate({
  key: 'slopes.geotech_visual',
  assetTypeId: 'slope',
  name: 'Geotechnical visual check',
  items: [
    { key: 'tensionCracks', label: 'Tension cracks visible', type: 'boolean', required: true },
    { key: 'seepage', label: 'Seepage / wet patches', type: 'boolean', required: true },
    { key: 'vegetationLoss', label: 'Vegetation loss', type: 'boolean' },
    { key: 'drainsClear', label: 'Slope drains clear', type: 'boolean', required: true },
    { key: 'overallScore', label: 'Overall condition (1-5)', type: 'score', required: true },
    { key: 'observations', label: 'Observations', type: 'note' },
  ],
});

registerReportCategory({
  key: 'slope_crack_or_slip',
  module: 'slopes',
  name: 'Slope crack / minor slip',
  priority: 'urgent',
});
