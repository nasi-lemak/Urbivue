import { z } from 'zod';
import { registerAssetType } from '../asset-types';
import { registerInspectionTemplate } from '../workflow';

/** Water Pumps module (Phase 2): stations (parents) and pumps (children). */

registerAssetType({
  id: 'pump_station',
  module: 'pumps',
  name: 'Pump station',
  geometryKind: 'point',
  attributes: z
    .object({
      sumpCapacityM3: z.number().positive().optional(),
      powerFeed: z.enum(['grid', 'grid_plus_generator', 'generator_only']).optional(),
      autoStartLevelM: z.number().optional(),
      notes: z.string().optional(),
    })
    .strict(),
  style: { color: '#0369a1', icon: 'square' },
});

registerAssetType({
  id: 'pump',
  module: 'pumps',
  name: 'Pump',
  geometryKind: 'point',
  attributes: z
    .object({
      ratedFlowLps: z.number().positive().optional(),
      headM: z.number().positive().optional(),
      powerKw: z.number().positive().optional(),
      driveType: z.enum(['electric', 'diesel']).optional(),
      notes: z.string().optional(),
    })
    .strict(),
  style: { color: '#0284c7', icon: 'circle' },
});

registerInspectionTemplate({
  key: 'pumps.station_check',
  assetTypeId: 'pump_station',
  name: 'Pump station check',
  items: [
    { key: 'testRunOk', label: 'Test run successful', type: 'boolean', required: true },
    { key: 'sumpClear', label: 'Sump free of debris', type: 'boolean', required: true },
    { key: 'generatorOk', label: 'Backup generator operational', type: 'boolean' },
    { key: 'panelScore', label: 'Control panel condition (1-5)', type: 'score' },
    { key: 'observations', label: 'Observations', type: 'note' },
  ],
});
