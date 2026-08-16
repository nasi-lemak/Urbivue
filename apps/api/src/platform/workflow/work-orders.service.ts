import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateWorkOrderInput,
  WORK_ORDER_STATUSES,
  WorkOrderStatus,
  canTransition,
} from '@urbivue/shared';
import { DbService } from '../db/db.service';

const WO_COLUMNS = `
  w.id, w.code, w.kind, w.priority, w.status, w.title, w.description,
  w.asset_id AS "assetId", a.code AS "assetCode", a.name AS "assetName",
  w.incident_id AS "incidentId", w.inspection_id AS "inspectionId",
  w.assignee_id AS "assigneeId", u.display_name AS "assigneeName",
  w.completion_notes AS "completionNotes",
  w.created_at AS "createdAt", w.assigned_at AS "assignedAt",
  w.started_at AS "startedAt", w.done_at AS "doneAt",
  w.verified_at AS "verifiedAt", w.cancelled_at AS "cancelledAt"`;

const WO_FROM = `
  FROM work_orders w
  LEFT JOIN assets a ON a.id = w.asset_id
  LEFT JOIN users u ON u.id = w.assignee_id`;

/** Timestamp column stamped when entering each status. */
const STATUS_TIMESTAMPS: Partial<Record<WorkOrderStatus, string>> = {
  assigned: 'assigned_at',
  in_progress: 'started_at',
  done: 'done_at',
  verified: 'verified_at',
  cancelled: 'cancelled_at',
};

@Injectable()
export class WorkOrdersService {
  constructor(private readonly db: DbService) {}

  async list(filters: { status?: string; assigneeId?: string }) {
    // 'active' is a virtual filter; a literal status must be a valid enum
    // value (validated here so it can't reach the enum cast as garbage).
    let statusWhere = 'TRUE';
    const params: unknown[] = [];
    if (filters.status === 'active') {
      statusWhere = `w.status NOT IN ('verified', 'cancelled')`;
    } else if (filters.status) {
      if (!(WORK_ORDER_STATUSES as readonly string[]).includes(filters.status)) {
        throw new BadRequestException(`Unknown status filter '${filters.status}'`);
      }
      params.push(filters.status);
      statusWhere = `w.status = $${params.length}::work_order_status`;
    }
    params.push(filters.assigneeId ?? null);
    const assigneeParam = params.length;

    const result = await this.db.query(
      `SELECT ${WO_COLUMNS} ${WO_FROM}
       WHERE ${statusWhere}
         AND ($${assigneeParam}::uuid IS NULL OR w.assignee_id = $${assigneeParam})
       ORDER BY
         CASE w.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         w.created_at DESC
       LIMIT 200`,
      params,
    );
    return result.rows;
  }

  async get(id: string) {
    const result = await this.db.query(`SELECT ${WO_COLUMNS} ${WO_FROM} WHERE w.id = $1`, [id]);
    if (!result.rows[0]) throw new NotFoundException(`Work order ${id} not found`);
    return result.rows[0];
  }

  async create(
    input: CreateWorkOrderInput & { inspectionId?: string | null },
    openedBy: string | null,
  ) {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO work_orders
         (asset_id, incident_id, inspection_id, kind, priority, title, description, opened_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        input.assetId ?? null,
        input.incidentId ?? null,
        input.inspectionId ?? null,
        input.kind,
        input.priority,
        input.title,
        input.description ?? null,
        openedBy,
      ],
    );
    return this.get(result.rows[0].id);
  }

  /** True when the asset already has an active corrective work order. */
  async hasActiveCorrective(assetId: string): Promise<boolean> {
    const result = await this.db.query(
      `SELECT 1 FROM work_orders
       WHERE asset_id = $1 AND kind = 'corrective' AND status NOT IN ('verified', 'cancelled')
       LIMIT 1`,
      [assetId],
    );
    return !!result.rowCount;
  }

  async transition(
    id: string,
    to: WorkOrderStatus,
    actor: string,
    opts: { assigneeId?: string; completionNotes?: string } = {},
  ) {
    const current = await this.get(id);
    const from = current.status as WorkOrderStatus;
    if (!canTransition(from, to)) {
      throw new BadRequestException(`Cannot transition work order from '${from}' to '${to}'`);
    }
    if (to === 'assigned' && !opts.assigneeId) {
      throw new BadRequestException('assigneeId is required to assign a work order');
    }

    const tsColumn = STATUS_TIMESTAMPS[to];
    await this.db.query(
      `UPDATE work_orders SET
         status = $2::work_order_status,
         assignee_id = CASE WHEN $2::text = 'assigned' THEN $3::uuid
                            WHEN $2::text = 'open' THEN NULL
                            ELSE assignee_id END,
         completion_notes = COALESCE($4, completion_notes)
         ${tsColumn ? `, ${tsColumn} = now()` : ''}
       WHERE id = $1`,
      [id, to, opts.assigneeId ?? actor, opts.completionNotes ?? null],
    );
    return this.get(id);
  }
}
