import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  SubmitInspectionInput,
  getInspectionTemplate,
  listInspectionTemplates,
  validateResponses,
} from '@urbivue/shared';
import { DbService } from '../db/db.service';
import { WorkOrdersService } from './work-orders.service';

/** Blockage at or above this auto-opens a cleaning work order (module spec). */
const DRAIN_BLOCKAGE_WO_THRESHOLD = 70;

@Injectable()
export class InspectionsService implements OnModuleInit {
  private readonly logger = new Logger(InspectionsService.name);

  constructor(
    private readonly db: DbService,
    private readonly workOrders: WorkOrdersService,
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
   * Module-specific reactions to a submitted inspection. Kept as a simple
   * dispatch until the module-contract plumbing lands with Phase 2.
   */
  private async runModuleHooks(
    templateKey: string,
    asset: { id: string; code: string; name: string; attributes: Record<string, unknown> },
    responses: Record<string, unknown>,
    inspectionId: string,
  ): Promise<{ workOrderId?: string }> {
    if (templateKey !== 'drainage.condition') return {};

    const blockagePct = responses['blockagePct'];
    if (typeof blockagePct !== 'number') return {};

    // Keep the asset's map attributes in sync with the latest inspection.
    await this.db.query(
      `UPDATE assets SET attributes = attributes || jsonb_build_object('blockagePct', $2::numeric)
       WHERE id = $1`,
      [asset.id, blockagePct],
    );

    if (blockagePct < DRAIN_BLOCKAGE_WO_THRESHOLD) return {};
    if (await this.workOrders.hasActiveCorrective(asset.id)) {
      this.logger.log(
        `Blockage ${blockagePct}% on ${asset.code}: active work order already exists`,
      );
      return {};
    }

    const wo = await this.workOrders.create(
      {
        assetId: asset.id,
        kind: 'corrective',
        priority: blockagePct >= 90 ? 'urgent' : 'high',
        title: `Clean ${asset.code} — blockage at ${blockagePct}%`,
        description: `Auto-created from inspection: ${asset.name} reported ${blockagePct}% blocked.`,
        inspectionId,
      },
      null,
    );
    this.logger.warn(`Auto-created work order ${wo.code} for ${asset.code}`);
    return { workOrderId: wo.id };
  }
}
