import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { DbService } from '../../platform/db/db.service';
import { Public } from '../../platform/auth/decorators';
import { PublicRateLimitGuard } from '../../platform/auth/rate-limit.guard';
import { zodParse } from '../../platform/zod';

const ratingSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

/** Public Toilets module: the citizen-facing finder + ratings. */
@Injectable()
export class ToiletsService {
  constructor(private readonly db: DbService) {}

  /** Public finder: location, fixtures, last cleaned, community rating. */
  async publicList() {
    const result = await this.db.query(
      `SELECT a.id, a.code, a.name, a.status,
              ST_AsGeoJSON(a.geom)::json AS geometry,
              a.attributes->>'openingHours' AS "openingHours",
              (a.attributes->>'accessibleFixtures')::int AS "accessibleFixtures",
              a.attributes->>'lastCleanedAt' AS "lastCleanedAt",
              round(avg(fr.stars)::numeric, 1) AS "avgRating",
              count(fr.id)::int AS "ratingCount"
       FROM assets a
       LEFT JOIN facility_ratings fr ON fr.asset_id = a.id
       WHERE a.type_id = 'toilet_facility' AND a.status <> 'decommissioned'
       GROUP BY a.id
       ORDER BY a.code`,
    );
    return result.rows;
  }

  async rate(assetId: string, stars: number, comment?: string) {
    const asset = await this.db.query(
      `SELECT 1 FROM assets WHERE id = $1 AND type_id = 'toilet_facility'`,
      [assetId],
    );
    if (!asset.rowCount) throw new NotFoundException(`No public toilet ${assetId}`);
    await this.db.query(
      `INSERT INTO facility_ratings (asset_id, stars, comment) VALUES ($1, $2, $3)`,
      [assetId, stars, comment ?? null],
    );
    return { ok: true };
  }
}

@Controller('public/toilets')
class PublicToiletsController {
  constructor(private readonly toilets: ToiletsService) {}

  @Public()
  @Get()
  list() {
    return this.toilets.publicList();
  }

  @Public()
  @UseGuards(PublicRateLimitGuard)
  @Post(':id/rating')
  rate(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { stars, comment } = zodParse(ratingSchema, body);
    return this.toilets.rate(id, stars, comment);
  }
}

@Module({
  controllers: [PublicToiletsController],
  providers: [ToiletsService, PublicRateLimitGuard],
})
export class ToiletsModule {}
