import { BadRequestException, Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { DbService } from '../../platform/db/db.service';
import { RequirePermission } from '../../platform/auth/decorators';

interface BinRow {
  id: string;
  code: string;
  name: string;
  stream: string;
  capacityL: number;
  fillPct: number | null;
  fillAt: string | null;
  lon: number;
  lat: number;
}

function haversineM(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Nearest-neighbor pickup ordering; proper VRP optimization is a later upgrade. */
export function orderByNearestNeighbor(bins: BinRow[], startLon: number, startLat: number) {
  const remaining = [...bins];
  const ordered: (BinRow & { legM: number })[] = [];
  let [lon, lat] = [startLon, startLat];
  while (remaining.length) {
    let best = 0;
    let bestDist = Infinity;
    remaining.forEach((b, i) => {
      const d = haversineM(lon, lat, b.lon, b.lat);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    const next = remaining.splice(best, 1)[0];
    ordered.push({ ...next, legM: Math.round(bestDist) });
    [lon, lat] = [next.lon, next.lat];
  }
  return ordered;
}

@Injectable()
export class BinsService {
  constructor(private readonly db: DbService) {}

  /**
   * Bins due for collection (latest fill >= threshold), grouped by stream and
   * ordered nearest-neighbor from the depot. Bins without fill sensors never
   * appear here — they stay on their fixed routes (routeId attribute).
   */
  async collectionList(thresholdPct: number) {
    const result = await this.db.query<BinRow>(
      `SELECT a.id, a.code, a.name,
              a.attributes->>'stream' AS stream,
              (a.attributes->>'capacityL')::numeric AS "capacityL",
              fill.value AS "fillPct", fill.ts AS "fillAt",
              ST_X(a.geom) AS lon, ST_Y(a.geom) AS lat
       FROM assets a
       JOIN sensors s ON s.asset_id = a.id AND s.kind = 'fill_level'
       JOIN LATERAL (
         SELECT value, ts FROM readings WHERE sensor_id = s.id ORDER BY ts DESC LIMIT 1
       ) fill ON TRUE
       WHERE a.type_id = 'waste_bin' AND a.status = 'active' AND fill.value >= $1`,
      [thresholdPct],
    );

    const depotLon = Number(process.env.DEPOT_LON ?? 101.69);
    const depotLat = Number(process.env.DEPOT_LAT ?? 3.14);
    const byStream = new Map<string, BinRow[]>();
    for (const bin of result.rows) {
      byStream.set(bin.stream, [...(byStream.get(bin.stream) ?? []), bin]);
    }
    return [...byStream.entries()].map(([stream, bins]) => {
      const stops = orderByNearestNeighbor(bins, depotLon, depotLat);
      return {
        stream,
        stops,
        totalDistanceM: stops.reduce((sum, s) => sum + s.legM, 0),
      };
    });
  }
}

@Controller('bins')
class BinsController {
  constructor(private readonly bins: BinsService) {}

  @RequirePermission('bins', 'read')
  @Get('collection-list')
  collectionList(@Query('threshold') threshold?: string) {
    const pct = Number(threshold ?? 75);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      throw new BadRequestException('threshold must be 0-100');
    }
    return this.bins.collectionList(pct);
  }
}

@Module({
  controllers: [BinsController],
  providers: [BinsService],
})
export class BinsModule {}
