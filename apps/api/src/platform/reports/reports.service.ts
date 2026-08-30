import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateReportInput,
  ReportStatus,
  canTransitionReport,
  getReportCategory,
  listAssetTypes,
} from '@urbivue/shared';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Reports of the same category within this radius are one issue. */
const DUPLICATE_RADIUS_M = 50;
/** How far to look for the asset a report is about. */
const ASSET_MATCH_RADIUS_M = 100;

const REPORT_COLUMNS = `
  r.id, r.category, r.module, r.description, r.status,
  r.reporter_contact AS "reporterContact",
  r.matched_asset_id AS "matchedAssetId", a.code AS "matchedAssetCode",
  r.duplicate_of_id AS "duplicateOfId",
  ST_AsGeoJSON(r.geom)::json AS geometry,
  r.created_at AS "createdAt", r.updated_at AS "updatedAt"`;

@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Public intake: validate, spatially dedup, match the nearest asset. */
  async create(input: CreateReportInput) {
    const category = getReportCategory(input.category);
    if (!category) throw new BadRequestException(`Unknown report category '${input.category}'`);
    const point = `SRID=4326;POINT(${input.location.lon} ${input.location.lat})`;

    const dup = await this.db.query<{ id: string }>(
      `SELECT id FROM citizen_reports
       WHERE category = $1 AND status NOT IN ('resolved', 'closed')
         AND duplicate_of_id IS NULL
         AND ST_DWithin(geom::geography, $2::geometry::geography, $3)
       ORDER BY created_at ASC
       LIMIT 1`,
      [category.key, point, DUPLICATE_RADIUS_M],
    );
    const duplicateOfId = dup.rows[0]?.id ?? null;

    const moduleTypeIds = listAssetTypes()
      .filter((t) => t.module === category.module)
      .map((t) => t.id);
    const match = await this.db.query<{ id: string }>(
      `SELECT id FROM assets
       WHERE type_id = ANY($1) AND status <> 'decommissioned'
         AND ST_DWithin(geom::geography, $2::geometry::geography, $3)
       ORDER BY geom <-> $2::geometry
       LIMIT 1`,
      [moduleTypeIds, point, ASSET_MATCH_RADIUS_M],
    );

    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO citizen_reports
         (category, module, description, geom, reporter_contact, matched_asset_id, duplicate_of_id)
       VALUES ($1, $2, $3, $4::geometry, $5, $6, $7)
       RETURNING id`,
      [
        category.key,
        category.module,
        input.description,
        point,
        input.contact ?? null,
        match.rows[0]?.id ?? null,
        duplicateOfId,
      ],
    );
    const id = inserted.rows[0].id;

    if (!duplicateOfId) {
      this.notifications.notify('info', `New citizen report: ${category.name}`, {
        module: category.module,
        reportId: id,
      });
    }
    return { id, status: 'new', duplicateOfId };
  }

  /** Public status lookup: no reporter identity, no internal details. */
  async publicStatus(id: string) {
    const result = await this.db.query(
      `SELECT id, category, status, created_at AS "createdAt",
              duplicate_of_id AS "duplicateOfId"
       FROM citizen_reports WHERE id = $1`,
      [id],
    );
    if (!result.rows[0]) throw new NotFoundException(`Report ${id} not found`);
    return result.rows[0];
  }

  /** Staff triage list; duplicates are folded into a count on the original. */
  async list(status?: string) {
    const active = !status || status === 'active';
    if (!active && !['new', 'triaged', 'in_progress', 'resolved', 'closed'].includes(status)) {
      throw new BadRequestException(`Unknown status filter '${status}'`);
    }
    const result = await this.db.query(
      `SELECT ${REPORT_COLUMNS},
              (SELECT count(*)::int FROM citizen_reports d WHERE d.duplicate_of_id = r.id)
                AS "duplicateCount",
              ward.code AS "wardCode"
       FROM citizen_reports r
       LEFT JOIN assets a ON a.id = r.matched_asset_id
       LEFT JOIN LATERAL (
         SELECT code FROM zones z
         WHERE z.kind = 'ward' AND ST_Intersects(r.geom, z.geom)
         LIMIT 1
       ) ward ON TRUE
       WHERE r.duplicate_of_id IS NULL
         AND (($2 AND r.status NOT IN ('resolved', 'closed')) OR r.status = $1::report_status)
       ORDER BY r.created_at DESC
       LIMIT 200`,
      [active ? 'new' : status, active],
    );
    return result.rows;
  }

  async transition(id: string, to: ReportStatus) {
    const current = await this.db.query<{ status: ReportStatus }>(
      'SELECT status FROM citizen_reports WHERE id = $1',
      [id],
    );
    if (!current.rows[0]) throw new NotFoundException(`Report ${id} not found`);
    if (!canTransitionReport(current.rows[0].status, to)) {
      throw new BadRequestException(
        `Cannot transition report from '${current.rows[0].status}' to '${to}'`,
      );
    }
    await this.db.query(
      `UPDATE citizen_reports SET status = $2::report_status
       WHERE id = $1 OR duplicate_of_id = $1`,
      [id, to],
    );
    return { id, status: to };
  }

  /** Turn a report into a work order and move it to in_progress. */
  async createWorkOrder(id: string, openedBy: string) {
    const report = await this.db.query<{
      id: string;
      category: string;
      status: ReportStatus;
      matched_asset_id: string | null;
      description: string;
    }>(
      'SELECT id, category, status, matched_asset_id, description FROM citizen_reports WHERE id = $1',
      [id],
    );
    const row = report.rows[0];
    if (!row) throw new NotFoundException(`Report ${id} not found`);
    const category = getReportCategory(row.category);

    const wo = await this.db.query<{ id: string; code: string }>(
      `INSERT INTO work_orders (asset_id, citizen_report_id, kind, priority, title, description, opened_by)
       VALUES ($1, $2, 'corrective', $3::work_order_priority, $4, $5, $6)
       RETURNING id, code`,
      [
        row.matched_asset_id,
        row.id,
        category?.priority ?? 'medium',
        `${category?.name ?? row.category}: citizen report`,
        row.description,
        openedBy,
      ],
    );
    if (canTransitionReport(row.status, 'in_progress')) {
      await this.transition(id, 'in_progress');
    }
    return { reportId: id, workOrderId: wo.rows[0].id, workOrderCode: wo.rows[0].code };
  }
}
