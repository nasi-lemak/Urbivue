import { z } from 'zod';
import type { WorkOrderPriority } from './workflow';

export const REPORT_STATUSES = ['new', 'triaged', 'in_progress', 'resolved', 'closed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_TRANSITIONS: Record<ReportStatus, readonly ReportStatus[]> = {
  new: ['triaged', 'in_progress', 'resolved', 'closed'],
  triaged: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'closed'],
  resolved: ['closed'],
  closed: [],
};

export function canTransitionReport(from: ReportStatus, to: ReportStatus): boolean {
  return REPORT_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Citizen-facing report categories, contributed by modules. */
export interface ReportCategoryDefinition {
  key: string;
  module: string;
  name: string;
  /** Priority for work orders created from reports in this category. */
  priority: WorkOrderPriority;
}

const categoryRegistry = new Map<string, ReportCategoryDefinition>();

export function registerReportCategory(def: ReportCategoryDefinition): void {
  if (categoryRegistry.has(def.key)) {
    throw new Error(`Report category '${def.key}' is already registered`);
  }
  categoryRegistry.set(def.key, def);
}

export function getReportCategory(key: string): ReportCategoryDefinition | undefined {
  return categoryRegistry.get(key);
}

export function listReportCategories(): ReportCategoryDefinition[] {
  return [...categoryRegistry.values()];
}

export const createReportSchema = z.object({
  category: z.string().min(1),
  description: z.string().min(10).max(2000),
  location: z.object({
    lon: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
  }),
  contact: z.string().max(200).optional(),
});
export type CreateReportInput = z.infer<typeof createReportSchema>;
