import { Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { DbService } from '../../platform/db/db.service';
import { PlatformEventsService } from '../../platform/events/events.service';
import { RulesModule } from '../../platform/rules/rules.module';
import { RulesService } from '../../platform/rules/rules.service';

/**
 * Slope Monitoring module logic. Sensor rules (tilt threshold/rate,
 * piezometer) live in alert_rules; this service adds the rain-correlation
 * composite: sustained heavy rainfall raises a watch on high-risk slopes
 * even before any movement is measured.
 */
@Injectable()
export class SlopesService implements OnModuleInit {
  private readonly logger = new Logger(SlopesService.name);

  constructor(
    private readonly db: DbService,
    private readonly events: PlatformEventsService,
    private readonly rules: RulesService,
  ) {}

  onModuleInit() {
    this.events.onIncidentOpened(async (event) => {
      if (event.ruleKey === 'flood.rain_intense') {
        await this.raiseRainWatch(event.title, event.sensorId);
      }
    });
  }

  private async raiseRainWatch(triggerTitle: string, sensorId?: string | null): Promise<void> {
    // Rain is physical, not administrative: scope to slopes within 3 km of
    // the reporting gauge (falls back to all high-risk slopes when the
    // gauge has no location).
    const slopes = await this.db.query<{ id: string; code: string; name: string }>(
      `SELECT a.id, a.code, a.name FROM assets a
       LEFT JOIN sensors s ON s.id = $1
       WHERE a.type_id = 'slope' AND a.status <> 'decommissioned'
         AND a.attributes->>'riskRanking' = 'high'
         AND (s.geom IS NULL
              OR ST_DWithin(a.geom::geography, s.geom::geography, 3000))`,
      [sensorId ?? null],
    );
    for (const slope of slopes.rows) {
      const opened = await this.rules.openModuleIncident({
        severity: 'warning',
        title: `Slope watch: heavy rainfall over high-risk slope ${slope.code}`,
        assetId: slope.id,
        detail: { module: 'slopes', trigger: triggerTitle, slope: slope.name },
      });
      if (opened) this.logger.warn(`Rain watch raised for ${slope.code}`);
    }
  }
}

@Module({
  imports: [RulesModule],
  providers: [SlopesService],
})
export class SlopesModule {}
