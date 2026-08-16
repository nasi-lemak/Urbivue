import { Controller, Injectable, Module, Post, Req } from '@nestjs/common';
import { DbService } from '../../platform/db/db.service';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { RequirePermission } from '../../platform/auth/decorators';
import type { AuthUser } from '../../platform/auth/auth.service';

/**
 * Tree Management module. Risk derivation lives in the inspection hook;
 * this service adds the post-storm rapid-assessment campaign.
 */
@Injectable()
export class TreesService {
  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * One tap after a storm: every high-risk tree gets an emergency
   * assessment work order (skipping trees that already have an active one).
   */
  async stormCampaign(openedBy: string) {
    const inserted = await this.db.query(
      `INSERT INTO work_orders (asset_id, kind, priority, title, description, opened_by)
       SELECT a.id, 'emergency', 'urgent',
              'Post-storm assessment: ' || a.code,
              'Rapid assessment after storm event — ' || a.name, $1
       FROM assets a
       WHERE a.type_id = 'tree' AND a.status <> 'decommissioned'
         AND a.attributes->>'riskRating' = 'high'
         AND NOT EXISTS (
           SELECT 1 FROM work_orders w
           WHERE w.asset_id = a.id AND w.kind = 'emergency'
             AND w.status NOT IN ('verified', 'cancelled')
         )
       RETURNING id`,
      [openedBy],
    );
    const created = inserted.rowCount ?? 0;
    if (created) {
      this.notifications.notify(
        'warning',
        `Storm campaign: ${created} tree assessment order(s) created`,
        {
          module: 'trees',
        },
      );
    }
    return { created };
  }
}

@Controller('trees')
class TreesController {
  constructor(private readonly trees: TreesService) {}

  @RequirePermission('trees', 'manage')
  @Post('storm-campaign')
  stormCampaign(@Req() req: { user: AuthUser }) {
    return this.trees.stormCampaign(req.user.sub);
  }
}

@Module({
  controllers: [TreesController],
  providers: [TreesService],
})
export class TreesModule {}
