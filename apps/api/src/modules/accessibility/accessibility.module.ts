import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { DbService } from '../../platform/db/db.service';
import { Public, RequirePermission } from '../../platform/auth/decorators';

/** Accessible Facilities: public accessibility layer + remediation backlog. */
@Injectable()
export class AccessibilityService {
  constructor(private readonly db: DbService) {}

  /** Public map layer: every feature with kind and compliance status. */
  async publicFeatures() {
    const result = await this.db.query(
      `SELECT a.code, a.name,
              a.attributes->>'featureKind' AS "featureKind",
              a.attributes->>'complianceStatus' AS "complianceStatus",
              a.attributes->>'linkedFacilityCode' AS "linkedFacilityCode",
              ST_AsGeoJSON(a.geom)::json AS geometry
       FROM assets a
       WHERE a.type_id = 'accessible_feature' AND a.status <> 'decommissioned'
       ORDER BY a.code`,
    );
    return result.rows;
  }

  /** Remediation backlog: worst first, with any active work order attached. */
  async backlog() {
    const result = await this.db.query(
      `SELECT a.id, a.code, a.name,
              a.attributes->>'featureKind' AS "featureKind",
              a.attributes->>'complianceStatus' AS "complianceStatus",
              w.code AS "workOrderCode", w.status AS "workOrderStatus"
       FROM assets a
       LEFT JOIN LATERAL (
         SELECT code, status FROM work_orders
         WHERE asset_id = a.id AND status NOT IN ('verified', 'cancelled')
         ORDER BY created_at DESC LIMIT 1
       ) w ON TRUE
       WHERE a.type_id = 'accessible_feature' AND a.status <> 'decommissioned'
         AND a.attributes->>'complianceStatus' IN ('non_compliant', 'minor_issues')
       ORDER BY CASE a.attributes->>'complianceStatus'
                  WHEN 'non_compliant' THEN 0 ELSE 1 END,
                a.code`,
    );
    return result.rows;
  }
}

@Controller()
class AccessibilityController {
  constructor(private readonly accessibility: AccessibilityService) {}

  @Public()
  @Get('public/accessibility')
  publicFeatures() {
    return this.accessibility.publicFeatures();
  }

  @RequirePermission('accessibility', 'read')
  @Get('accessibility/backlog')
  backlog() {
    return this.accessibility.backlog();
  }
}

@Module({
  controllers: [AccessibilityController],
  providers: [AccessibilityService],
})
export class AccessibilityModule {}
