import { z } from 'zod';
import { registerAssetType } from '../asset-types';
import { registerInspectionTemplate } from '../workflow';
import { registerReportCategory } from '../reports';

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

registerInspectionTemplate({
  key: 'flood.station_check',
  assetTypeId: 'monitoring_station',
  name: 'Monitoring station check',
  items: [
    { key: 'sensorClean', label: 'Sensor free of debris', type: 'boolean', required: true },
    { key: 'mountSecure', label: 'Mounting secure', type: 'boolean', required: true },
    { key: 'batteryPct', label: 'Battery level (%)', type: 'number', min: 0, max: 100 },
    { key: 'observations', label: 'Observations', type: 'note' },
  ],
});

registerReportCategory({
  key: 'street_flooding',
  module: 'flood',
  name: 'Street flooding',
  priority: 'urgent',
});
