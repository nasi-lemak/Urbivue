import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { DbService } from '../../platform/db/db.service';
import { RequirePermission } from '../../platform/auth/decorators';

/**
 * Drain network traversal over the declared topology: each drain_line's
 * upstreamNodeCode/downstreamNodeCode attributes are the edges. Geometry
 * is not consulted — the declared codes are the source of truth.
 */

const MAX_DEPTH = 100; // cycle guard; real drain networks are DAGs

interface TraceLine {
  code: string;
  name: string;
  depth: number;
  upstreamNodeCode: string | null;
  downstreamNodeCode: string | null;
  blockagePct: number | null;
}

interface TraceNode {
  code: string;
  name: string;
  kind: string | null;
}

@Injectable()
export class DrainageService {
  constructor(private readonly db: DbService) {}

  async trace(code: string, direction: 'upstream' | 'downstream') {
    const start = await this.db.query<{ type_id: string; up: string | null; down: string | null }>(
      `SELECT type_id, attributes->>'upstreamNodeCode' AS up,
              attributes->>'downstreamNodeCode' AS down
       FROM assets
       WHERE code = $1 AND type_id IN ('drain_line', 'drain_node')
         AND status <> 'decommissioned'`,
      [code],
    );
    const row = start.rows[0];
    if (!row) throw new NotFoundException(`No drain line or node with code '${code}'`);

    // Normalize the start to a node: a line contributes itself plus its
    // far-side node in the direction of travel.
    let startNode: string | null;
    const seedLines: string[] = [];
    if (row.type_id === 'drain_node') {
      startNode = code;
    } else {
      seedLines.push(code);
      startNode = direction === 'downstream' ? row.down : row.up;
    }

    const lines = startNode
      ? await this.db.query<TraceLine>(
          direction === 'downstream'
            ? `WITH RECURSIVE edges AS (
                 SELECT code, name,
                        attributes->>'upstreamNodeCode' AS up,
                        attributes->>'downstreamNodeCode' AS down,
                        (attributes->>'blockagePct')::numeric AS blockage
                 FROM assets WHERE type_id = 'drain_line' AND status <> 'decommissioned'
               ),
               walk AS (
                 SELECT e.code, e.name, e.up, e.down, e.blockage, 1 AS depth
                 FROM edges e WHERE e.up = $1
                 UNION ALL
                 SELECT e.code, e.name, e.up, e.down, e.blockage, w.depth + 1
                 FROM edges e JOIN walk w ON e.up = w.down
                 WHERE w.depth < $2
               )
               SELECT DISTINCT ON (code) code, name, depth,
                      up AS "upstreamNodeCode", down AS "downstreamNodeCode",
                      blockage AS "blockagePct"
               FROM walk ORDER BY code, depth`
            : `WITH RECURSIVE edges AS (
                 SELECT code, name,
                        attributes->>'upstreamNodeCode' AS up,
                        attributes->>'downstreamNodeCode' AS down,
                        (attributes->>'blockagePct')::numeric AS blockage
                 FROM assets WHERE type_id = 'drain_line' AND status <> 'decommissioned'
               ),
               walk AS (
                 SELECT e.code, e.name, e.up, e.down, e.blockage, 1 AS depth
                 FROM edges e WHERE e.down = $1
                 UNION ALL
                 SELECT e.code, e.name, e.up, e.down, e.blockage, w.depth + 1
                 FROM edges e JOIN walk w ON e.down = w.up
                 WHERE w.depth < $2
               )
               SELECT DISTINCT ON (code) code, name, depth,
                      up AS "upstreamNodeCode", down AS "downstreamNodeCode",
                      blockage AS "blockagePct"
               FROM walk ORDER BY code, depth`,
          [startNode, MAX_DEPTH],
        )
      : { rows: [] as TraceLine[] };

    const orderedLines = [...lines.rows].sort((a, b) => a.depth - b.depth);

    // Nodes touched by the walk (excluding the start), with their kinds so
    // the caller can spot the outfall at the end of a downstream trace.
    const nodeCodes = new Set<string>();
    if (startNode && row.type_id === 'drain_line') nodeCodes.add(startNode);
    for (const line of orderedLines) {
      const far = direction === 'downstream' ? line.downstreamNodeCode : line.upstreamNodeCode;
      if (far && far !== code) nodeCodes.add(far);
    }
    const nodes = nodeCodes.size
      ? await this.db.query<TraceNode>(
          `SELECT code, name, attributes->>'kind' AS kind
           FROM assets WHERE type_id = 'drain_node' AND code = ANY($1)`,
          [[...nodeCodes]],
        )
      : { rows: [] as TraceNode[] };
    const nodeByCode = new Map(nodes.rows.map((n) => [n.code, n]));

    return {
      start: code,
      direction,
      lines: [
        ...seedLines.map((c) => ({ code: c, depth: 0 })),
        ...orderedLines.map((l) => ({
          code: l.code,
          depth: l.depth,
          blockagePct: l.blockagePct === null ? null : Number(l.blockagePct),
        })),
      ],
      nodes: [...nodeCodes].map((c) => {
        const n = nodeByCode.get(c);
        return { code: c, kind: n?.kind ?? null, name: n?.name ?? null };
      }),
    };
  }
}

@Controller('drainage')
class DrainageController {
  constructor(private readonly drainage: DrainageService) {}

  @RequirePermission('drainage', 'read')
  @Get('network/:code/trace')
  trace(@Param('code') code: string, @Query('direction') direction?: string) {
    if (direction !== 'upstream' && direction !== 'downstream') {
      throw new BadRequestException(`direction must be 'upstream' or 'downstream'`);
    }
    return this.drainage.trace(code, direction);
  }
}

@Module({ controllers: [DrainageController], providers: [DrainageService] })
export class DrainageModule {}
