import { z } from 'zod';
import { registerAssetType } from '../asset-types';
import { registerInspectionTemplate } from '../workflow';
import { registerReportCategory } from '../reports';

/**
 * Accessible Facilities module (Phase 4): pure inventory + audit + citizen
 * engagement — no sensors, proving the platform works without telemetry.
 */

registerAssetType({
  id: 'accessible_feature',
  module: 'accessibility',
  name: 'Accessibility feature',
  geometryKind: 'point',
  attributes: z
    .object({
      featureKind: z.enum([
        'ramp',
        'tactile_path',
        'accessible_parking',
        'lift',
        'audio_signal',
        'accessible_toilet',
      ]),
      complianceStatus: z.enum(['compliant', 'minor_issues', 'non_compliant', 'unknown']),
      slopePct: z.number().min(0).optional(),
      widthCm: z.number().positive().optional(),
      /** Cross-link to e.g. a toilet_facility asset code. */
      linkedFacilityCode: z.string().optional(),
      notes: z.string().optional(),
    })
    .strict(),
  style: { color: '#1d4ed8', icon: 'square' },
});

/**
 * Compliance audit. The accessibility hook derives complianceStatus:
 * all checks pass -> compliant; one failure -> minor_issues; more ->
 * non_compliant. Failures land in the remediation backlog.
 */
registerInspectionTemplate({
  key: 'accessibility.audit',
  assetTypeId: 'accessible_feature',
  name: 'Accessibility compliance audit',
  items: [
    { key: 'slopeOk', label: 'Gradient within standard', type: 'boolean', required: true },
    { key: 'widthOk', label: 'Clear width within standard', type: 'boolean', required: true },
    { key: 'surfaceOk', label: 'Surface firm / tactile intact', type: 'boolean', required: true },
    { key: 'signageOk', label: 'Signage / markings present', type: 'boolean', required: true },
    { key: 'observations', label: 'Observations', type: 'note' },
  ],
});

registerReportCategory({
  key: 'blocked_ramp',
  module: 'accessibility',
  name: 'Ramp blocked (e.g. parked vehicle)',
  priority: 'high',
});
registerReportCategory({
  key: 'damaged_tactile_paving',
  module: 'accessibility',
  name: 'Damaged tactile paving',
  priority: 'medium',
});
registerReportCategory({
  key: 'broken_lift',
  module: 'accessibility',
  name: 'Lift out of service',
  priority: 'urgent',
});
