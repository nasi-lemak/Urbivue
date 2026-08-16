import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { DbService } from '../../platform/db/db.service';
import { Public, RequirePermission } from '../../platform/auth/decorators';

/**
 * Traffic Counters module: analytics over ingested counts, plus a public
 * read-only data API — planners and consultants are the users, so clean
 * exports matter more than dashboards here.
 */
@Injectable()
export class TrafficService {
  constructor(private readonly db: DbService) {}

  stations() {
    return this.db
      .query(
        `SELECT a.code, a.name, a.attributes->>'roadName' AS "roadName",
                a.attributes->>'technology' AS technology,
                s.external_id AS "sensorExternalId",
                ST_AsGeoJSON(a.geom)::json AS geometry
         FROM assets a
         JOIN sensors s ON s.asset_id = a.id AND s.kind = 'vehicle_count'
         WHERE a.type_id = 'traffic_counter' AND a.status <> 'decommissioned'
         ORDER BY a.code`,
      )
      .then((r) => r.rows);
  }

  private async sensorId(externalId: string): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `SELECT s.id FROM sensors s WHERE s.external_id = $1 AND s.kind = 'vehicle_count'`,
      [externalId],
    );
    if (!result.rows[0]) throw new NotFoundException(`Unknown counter '${externalId}'`);
    return result.rows[0].id;
  }

  /** Hourly profile + daily totals — the planner's first questions. */
  async stats(externalId: string) {
    const id = await this.sensorId(externalId);
    const [hourly, daily] = await Promise.all([
      this.db.query(
        `SELECT extract(hour FROM ts)::int AS hour,
                round(avg(value)::numeric, 1) AS "avgCount", count(*)::int AS samples
         FROM readings WHERE sensor_id = $1
         GROUP BY 1 ORDER BY 1`,
        [id],
      ),
      this.db.query(
        `SELECT date_trunc('day', ts)::date AS day, sum(value)::int AS total
         FROM readings WHERE sensor_id = $1
         GROUP BY 1 ORDER BY 1 DESC LIMIT 30`,
        [id],
      ),
    ]);
    return { counter: externalId, hourlyProfile: hourly.rows, dailyTotals: daily.rows };
  }

  async counts(externalId: string, from?: string, to?: string) {
    const id = await this.sensorId(externalId);
    const result = await this.db.query<{ ts: string; value: number }>(
      `SELECT ts, value FROM readings
       WHERE sensor_id = $1
         AND ($2::timestamptz IS NULL OR ts >= $2)
         AND ($3::timestamptz IS NULL OR ts <= $3)
       ORDER BY ts ASC
       LIMIT 50000`,
      [id, from ?? null, to ?? null],
    );
    return result.rows;
  }
}

@Controller('traffic')
class TrafficController {
  constructor(private readonly traffic: TrafficService) {}

  @RequirePermission('traffic', 'read')
  @Get('stats/:counter')
  stats(@Param('counter') counter: string) {
    return this.traffic.stats(counter);
  }
}

/** Open data: station list and raw counts, JSON or CSV. */
@Controller('public/traffic')
class PublicTrafficController {
  constructor(private readonly traffic: TrafficService) {}

  @Public()
  @Get('stations')
  stations() {
    return this.traffic.stations();
  }

  @Public()
  @Get('counts/:counter')
  @Header('Cache-Control', 'public, max-age=300')
  async counts(
    @Param('counter') counter: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format?: string,
  ) {
    if (format && !['json', 'csv'].includes(format)) {
      throw new BadRequestException(`format must be 'json' or 'csv'`);
    }
    const rows = await this.traffic.counts(counter, from, to);
    if (format === 'csv') {
      return ['ts,count', ...rows.map((r) => `${new Date(r.ts).toISOString()},${r.value}`)].join(
        '\n',
      );
    }
    return rows;
  }
}

@Module({
  controllers: [TrafficController, PublicTrafficController],
  providers: [TrafficService],
})
export class TrafficModule {}
