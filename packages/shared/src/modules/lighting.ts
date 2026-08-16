import { z } from 'zod';
import { registerAssetType } from '../asset-types';
import { registerInspectionTemplate } from '../workflow';
import { registerReportCategory } from '../reports';

/**
 * Street Lighting module (Phase 3). Fully useful with zero sensors (citizen
 * reports + night patrol inspections); smart poles with power telemetry get
 * automatic outage / day-burner / circuit-fault detection.
 */

registerAssetType({
  id: 'light_pole',
  module: 'lighting',
  name: 'Light pole',
  geometryKind: 'point',
  attributes: z
    .object({
      poleHeightM: z.number().positive().optional(),
      luminaireType: z.enum(['led', 'hps', 'metal_halide', 'fluorescent']).optional(),
      wattage: z.number().positive().optional(),
      circuitId: z.string().optional(),
      smartNode: z.boolean().optional(),
      notes: z.string().optional(),
    })
    .strict(),
  style: { color: '#eab308', icon: 'circle' },
});

registerInspectionTemplate({
  key: 'lighting.night_patrol',
  assetTypeId: 'light_pole',
  name: 'Night patrol check',
  items: [
    { key: 'lampLit', label: 'Lamp lit', type: 'boolean', required: true },
    { key: 'poleUpright', label: 'Pole upright and undamaged', type: 'boolean', required: true },
    { key: 'doorSecure', label: 'Access door secure', type: 'boolean' },
    { key: 'observations', label: 'Observations', type: 'note' },
  ],
});

registerReportCategory({
  key: 'street_light_out',
  module: 'lighting',
  name: 'Street light not working',
  priority: 'medium',
});
registerReportCategory({
  key: 'damaged_light_pole',
  module: 'lighting',
  name: 'Damaged pole / exposed wiring',
  priority: 'urgent',
});
