import {
  CreateAssetInput,
  GeoJsonFeature,
  createAssetSchema,
  geometryTypeMatches,
  getAssetType,
  validateAttributes,
} from '@urbivue/shared';

export type ParsedFeature = { ok: true; input: CreateAssetInput } | { ok: false; errors: string[] };

/**
 * Validate a CreateAssetInput fully against the shared registry: payload
 * shape, known type, geometry kind, and per-type attribute schema.
 */
export function validateAssetInput(raw: unknown): ParsedFeature {
  const parsed = createAssetSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  const input = parsed.data;

  const def = getAssetType(input.typeId);
  if (!def) return { ok: false, errors: [`Unknown asset type '${input.typeId}'`] };

  if (!geometryTypeMatches(def.geometryKind, input.geometry.type)) {
    return {
      ok: false,
      errors: [
        `Geometry '${input.geometry.type}' does not match kind '${def.geometryKind}' of type '${def.id}'`,
      ],
    };
  }

  const attrs = validateAttributes(input.typeId, input.attributes);
  if (!attrs.success) return { ok: false, errors: attrs.errors };

  return { ok: true, input: { ...input, attributes: attrs.data } };
}

/**
 * Map a GeoJSON feature (as produced by our export, QGIS, etc.) to a
 * CreateAssetInput for a given asset type. Recognized properties: code, name,
 * status, conditionScore; everything else goes into attributes.
 */
export function featureToAssetInput(typeId: string, feature: GeoJsonFeature): unknown {
  const { code, name, status, conditionScore, ...attributes } = feature.properties ?? {};
  return {
    typeId,
    code: code ?? undefined,
    name: name ?? 'Unnamed',
    status: status ?? undefined,
    conditionScore: conditionScore ?? undefined,
    geometry: feature.geometry,
    attributes,
  };
}
