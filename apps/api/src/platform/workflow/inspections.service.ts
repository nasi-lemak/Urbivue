import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  SubmitInspectionInput,
  WorkOrderKind,
  WorkOrderPriority,
  getInspectionTemplate,
  listInspectionTemplates,
  validateResponses,
} from '@urbivue/shared';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkOrdersService } from './work-orders.service';

/** Blockage at or above this auto-opens a cleaning work order (module spec). */
const DRAIN_BLOCKAGE_WO_THRESHOLD = 70;

@Injectable()
export class InspectionsService implements OnModuleInit {
  private readonly logger = new Logger(InspectionsService.name);

  constructor(
    private readonly db: DbService,
    private readonly workOrders: WorkOrdersService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Mirror the code-defined template registry into the DB (FK integrity). */
  async onModuleInit() {
    try {
      for (const t of listInspectionTemplates()) {
        await this.db.query(
          `INSERT INTO inspection_templates (key, asset_type_id, name, items)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (key) DO UPDATE SET
             asset_type_id = EXCLUDED.asset_type_id, name = EXCLUDED.name, items = EXCLUDED.items`,
          [t.key, t.assetTypeId, t.name, JSON.stringify(t.items)],
        );
      }
      this.logger.log(`Synced ${listInspectionTemplates().length} inspection templates`);
    } catch (err) {
      this.logger.error(`Template sync failed (has the DB been migrated?): ${err}`);
    }
  }

  listForAsset(assetId: string) {
    return this.db
      .query(
        `SELECT i.id, i.template_key AS "templateKey", t.name AS "templateName",
                i.performed_at AS "performedAt", i.responses,
                i.condition_score AS "conditionScore", i.notes,
                u.display_name AS "inspectorName"
         FROM inspections i
         JOIN inspection_templates t ON t.key = i.template_key
         LEFT JOIN users u ON u.id = i.inspector_id
         WHERE i.asset_id = $1
         ORDER BY i.performed_at DESC
         LIMIT 50`,
        [assetId],
      )
      .then((r) => r.rows);
  }

  async submit(input: SubmitInspectionInput, inspectorId: string) {
    const template = getInspectionTemplate(input.templateKey);
    if (!template) throw new BadRequestException(`Unknown template '${input.templateKey}'`);

    const asset = await this.db.query<{
      id: string;
      type_id: string;
      code: string;
      name: string;
      attributes: Record<string, unknown>;
    }>('SELECT id, type_id, code, name, attributes FROM assets WHERE id = $1', [input.assetId]);
    const assetRow = asset.rows[0];
    if (!assetRow) throw new NotFoundException(`Asset ${input.assetId} not found`);
    if (assetRow.type_id !== template.assetTypeId) {
      throw new BadRequestException(
        `Template '${template.key}' applies to '${template.assetTypeId}', not '${assetRow.type_id}'`,
      );
    }

    const validated = validateResponses(template, input.responses as Record<string, unknown>);
    if (!validated.success) {
      throw new BadRequestException({ message: 'Validation failed', errors: validated.errors });
    }

    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO inspections (asset_id, template_key, inspector_id, responses, condition_score, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        assetRow.id,
        template.key,
        inspectorId,
        JSON.stringify(validated.data),
        input.conditionScore ?? null,
        input.notes ?? null,
      ],
    );
    const inspectionId = inserted.rows[0].id;

    if (input.conditionScore != null) {
      await this.db.query('UPDATE assets SET condition_score = $2 WHERE id = $1', [
        assetRow.id,
        input.conditionScore,
      ]);
    }

    const followUp = await this.runModuleHooks(
      template.key,
      assetRow,
      validated.data,
      inspectionId,
    );
    return { id: inspectionId, ...followUp };
  }

  /**
   * Module-specific reactions to a submitted inspection, dispatched by
   * template key. Each hook may update asset attributes and/or open a
   * follow-up work order.
   */
  private async runModuleHooks(
    templateKey: string,
    asset: HookAsset,
    responses: Record<string, unknown>,
    inspectionId: string,
  ): Promise<{ workOrderId?: string }> {
    switch (templateKey) {
      case 'drainage.condition':
        return this.drainageHook(asset, responses, inspectionId);
      case 'trees.risk_assessment':
        return this.treesHook(asset, responses, inspectionId);
      case 'toilets.cleaning_round':
        return this.toiletsHook(asset, responses, inspectionId);
      case 'accessibility.audit':
        return this.accessibilityHook(asset, responses, inspectionId);
      default:
        return {};
    }
  }

  private async mergeAttributes(assetId: string, patch: Record<string, unknown>): Promise<void> {
    await this.db.query(`UPDATE assets SET attributes = attributes || $2::jsonb WHERE id = $1`, [
      assetId,
      JSON.stringify(patch),
    ]);
  }

  /** Open a follow-up work order unless the asset already has an active one. */
  private async followUpWorkOrder(
    asset: HookAsset,
    inspectionId: string,
    module: string,
    input: {
      kind: WorkOrderKind;
      priority: WorkOrderPriority;
      title: string;
      description: string;
    },
  ): Promise<{ workOrderId?: string }> {
    if (await this.workOrders.hasActiveCorrective(asset.id)) {
      this.logger.log(`${asset.code}: active work order already exists, not duplicating`);
      return {};
    }
    const wo = await this.workOrders.create(
      {
        assetId: asset.id,
        kind: input.kind,
        priority: input.priority,
        title: input.title,
        description: input.description,
        inspectionId,
      },
      null,
    );
    this.notifications.notify('warning', `Work order ${wo.code} auto-created: ${wo.title}`, {
      module,
      assetCode: asset.code,
    });
    return { workOrderId: wo.id };
  }

  private async drainageHook(
    asset: HookAsset,
    responses: Record<string, unknown>,
    inspectionId: string,
  ): Promise<{ workOrderId?: string }> {
    const blockagePct = responses['blockagePct'];
    if (typeof blockagePct !== 'number') return {};
    await this.mergeAttributes(asset.id, { blockagePct });
    if (blockagePct < DRAIN_BLOCKAGE_WO_THRESHOLD) return {};
    return this.followUpWorkOrder(asset, inspectionId, 'drainage', {
      kind: 'corrective',
      priority: blockagePct >= 90 ? 'urgent' : 'high',
      title: `Clean ${asset.code} — blockage at ${blockagePct}%`,
      description: `Auto-created from inspection: ${asset.name} reported ${blockagePct}% blocked.`,
    });
  }

  /** Derive health/risk ratings; high risk escalates to an arborist order. */
  private async treesHook(
    asset: HookAsset,
    responses: Record<string, unknown>,
    inspectionId: string,
  ): Promise<{ workOrderId?: string }> {
    const healthScore = responses['healthScore'];
    if (typeof healthScore !== 'number') return {};
    const defects = ['deadwood', 'cavities', 'rootDamage', 'leanChange'].filter(
      (k) => responses[k] === true,
    );
    const riskRating =
      defects.length >= 2 || healthScore <= 2 ? 'high' : defects.length === 1 ? 'medium' : 'low';
    await this.mergeAttributes(asset.id, { healthRating: healthScore, riskRating });
    if (riskRating !== 'high') return {};
    return this.followUpWorkOrder(asset, inspectionId, 'trees', {
      kind: 'corrective',
      priority: responses['leanChange'] === true ? 'urgent' : 'high',
      title: `Arborist action: ${asset.code} assessed high-risk`,
      description: `Defects: ${defects.join(', ') || 'none'}; health ${healthScore}/5.`,
    });
  }

  /** Stamp lastCleanedAt for the public map; broken fixtures open an order. */
  private async toiletsHook(
    asset: HookAsset,
    responses: Record<string, unknown>,
    inspectionId: string,
  ): Promise<{ workOrderId?: string }> {
    await this.mergeAttributes(asset.id, { lastCleanedAt: new Date().toISOString() });
    if (responses['fixturesOk'] !== false) return {};
    return this.followUpWorkOrder(asset, inspectionId, 'toilets', {
      kind: 'corrective',
      priority: 'medium',
      title: `Fixture repair: ${asset.code}`,
      description: `Cleaning check-in reported broken fixtures at ${asset.name}.`,
    });
  }

  /** Derive compliance status; non-compliance lands in the remediation backlog. */
  private async accessibilityHook(
    asset: HookAsset,
    responses: Record<string, unknown>,
    inspectionId: string,
  ): Promise<{ workOrderId?: string }> {
    const checks = ['slopeOk', 'widthOk', 'surfaceOk', 'signageOk'];
    const failures = checks.filter((k) => responses[k] === false);
    const complianceStatus =
      failures.length === 0
        ? 'compliant'
        : failures.length === 1
          ? 'minor_issues'
          : 'non_compliant';
    await this.mergeAttributes(asset.id, { complianceStatus });
    if (complianceStatus !== 'non_compliant') return {};
    return this.followUpWorkOrder(asset, inspectionId, 'accessibility', {
      kind: 'corrective',
      priority: 'high',
      title: `Accessibility remediation: ${asset.code}`,
      description: `Audit failures: ${failures.join(', ')}.`,
    });
  }
}

interface HookAsset {
  id: string;
  code: string;
  name: string;
  attributes: Record<string, unknown>;
}
