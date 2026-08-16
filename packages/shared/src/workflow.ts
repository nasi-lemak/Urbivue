import { z } from 'zod';

// ---------------------------------------------------------------------------
// Inspection templates: per-asset-type checklists defined in code by modules
// (mirrored to the DB for FK integrity, like asset types).
// ---------------------------------------------------------------------------

export const CHECKLIST_ITEM_TYPES = ['boolean', 'score', 'number', 'note'] as const;
export type ChecklistItemType = (typeof CHECKLIST_ITEM_TYPES)[number];

export interface ChecklistItem {
  key: string;
  label: string;
  type: ChecklistItemType;
  required?: boolean;
  /** For 'number' items. */
  min?: number;
  max?: number;
}

export interface InspectionTemplateDefinition {
  key: string;
  assetTypeId: string;
  name: string;
  items: ChecklistItem[];
}

const templateRegistry = new Map<string, InspectionTemplateDefinition>();

export function registerInspectionTemplate(def: InspectionTemplateDefinition): void {
  if (templateRegistry.has(def.key)) {
    throw new Error(`Inspection template '${def.key}' is already registered`);
  }
  templateRegistry.set(def.key, def);
}

export function getInspectionTemplate(key: string): InspectionTemplateDefinition | undefined {
  return templateRegistry.get(key);
}

export function listInspectionTemplates(): InspectionTemplateDefinition[] {
  return [...templateRegistry.values()];
}

export type ResponseValidation =
  { success: true; data: Record<string, unknown> } | { success: false; errors: string[] };

/** Validate inspection responses against a template's checklist. */
export function validateResponses(
  template: InspectionTemplateDefinition,
  responses: Record<string, unknown>,
): ResponseValidation {
  const errors: string[] = [];
  const data: Record<string, unknown> = {};

  for (const item of template.items) {
    const value = responses[item.key];
    if (value === undefined || value === null || value === '') {
      if (item.required) errors.push(`${item.key}: required`);
      continue;
    }
    switch (item.type) {
      case 'boolean':
        if (typeof value !== 'boolean') errors.push(`${item.key}: expected boolean`);
        else data[item.key] = value;
        break;
      case 'score':
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
          errors.push(`${item.key}: expected integer score 1-5`);
        } else data[item.key] = value;
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push(`${item.key}: expected number`);
        } else if (
          (item.min !== undefined && value < item.min) ||
          (item.max !== undefined && value > item.max)
        ) {
          errors.push(`${item.key}: out of range ${item.min ?? '-∞'}..${item.max ?? '∞'}`);
        } else data[item.key] = value;
        break;
      case 'note':
        if (typeof value !== 'string') errors.push(`${item.key}: expected text`);
        else data[item.key] = value;
        break;
    }
  }

  const known = new Set(template.items.map((i) => i.key));
  for (const key of Object.keys(responses)) {
    if (!known.has(key)) errors.push(`${key}: not part of template '${template.key}'`);
  }

  return errors.length ? { success: false, errors } : { success: true, data };
}

export const submitInspectionSchema = z.object({
  assetId: z.string().uuid(),
  templateKey: z.string().min(1),
  responses: z.record(z.unknown()).default({}),
  conditionScore: z.number().int().min(1).max(5).nullish(),
  notes: z.string().max(4000).nullish(),
});
export type SubmitInspectionInput = z.infer<typeof submitInspectionSchema>;

// ---------------------------------------------------------------------------
// Work orders
// ---------------------------------------------------------------------------

export const WORK_ORDER_STATUSES = [
  'open',
  'assigned',
  'in_progress',
  'done',
  'verified',
  'cancelled',
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const WORK_ORDER_KINDS = ['corrective', 'preventive', 'emergency'] as const;
export type WorkOrderKind = (typeof WORK_ORDER_KINDS)[number];

export const WORK_ORDER_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

/** Allowed lifecycle transitions. 'done' -> 'in_progress' is verifier rework. */
export const WORK_ORDER_TRANSITIONS: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  open: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'open', 'cancelled'],
  in_progress: ['done', 'cancelled'],
  done: ['verified', 'in_progress'],
  verified: [],
  cancelled: [],
};

export function canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return WORK_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export const createWorkOrderSchema = z.object({
  assetId: z.string().uuid().nullish(),
  incidentId: z.string().uuid().nullish(),
  kind: z.enum(WORK_ORDER_KINDS).default('corrective'),
  priority: z.enum(WORK_ORDER_PRIORITIES).default('medium'),
  title: z.string().min(1).max(300),
  description: z.string().max(4000).nullish(),
});
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;
