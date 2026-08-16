import { z } from 'zod';
import { registerAssetType } from '../asset-types';
import { registerInspectionTemplate } from '../workflow';
import { registerReportCategory } from '../reports';

/** Public Toilets module (Phase 4): findable, clean, measurable service. */

registerAssetType({
  id: 'toilet_facility',
  module: 'toilets',
  name: 'Public toilet',
  geometryKind: 'point',
  attributes: z
    .object({
      maleFixtures: z.number().int().min(0),
      femaleFixtures: z.number().int().min(0),
      accessibleFixtures: z.number().int().min(0),
      openingHours: z.string().optional(),
      operator: z.string().optional(),
      /** Stamped by the cleaning check-in hook; shown on the public map. */
      lastCleanedAt: z.string().optional(),
      notes: z.string().optional(),
    })
    .strict(),
  style: { color: '#0d9488', icon: 'square' },
});

/** Cleaning round check-in; submitting stamps lastCleanedAt on the asset. */
registerInspectionTemplate({
  key: 'toilets.cleaning_round',
  assetTypeId: 'toilet_facility',
  name: 'Cleaning round check-in',
  items: [
    {
      key: 'cleanScore',
      label: 'Cleanliness (1 dirty - 5 spotless)',
      type: 'score',
      required: true,
    },
    { key: 'suppliesOk', label: 'Soap / paper stocked', type: 'boolean', required: true },
    { key: 'fixturesOk', label: 'All fixtures working', type: 'boolean', required: true },
    { key: 'observations', label: 'Observations', type: 'note' },
  ],
});

registerReportCategory({
  key: 'dirty_toilet',
  module: 'toilets',
  name: 'Toilet dirty / no supplies',
  priority: 'high',
});
registerReportCategory({
  key: 'toilet_broken',
  module: 'toilets',
  name: 'Broken fixture',
  priority: 'medium',
});
registerReportCategory({
  key: 'toilet_locked',
  module: 'toilets',
  name: 'Locked during posted hours',
  priority: 'medium',
});
