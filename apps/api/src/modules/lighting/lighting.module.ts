import {
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
  Post,
} from '@nestjs/common';
import { DbService } from '../../platform/db/db.service';
import { RulesModule } from '../../platform/rules/rules.module';
import { RulesService } from '../../platform/rules/rules.service';
import { RequirePermission } from '../../platform/auth/decorators';

const SWEEP_MS = 10 * 60 * 1000;
/** Below this draw (W) a lamp counts as dark; above it, as burning. */
const POWER_THRESHOLD_W = 5;
/** A reading older than this proves nothing either way. */
const FRESH_MINUTES = 120;
/** This many dark poles on one circuit roll up into a single circuit fault. */
const CIRCUIT_FAULT_MIN = 3;

interface PoleReading {
  id: string;
  code: string;
  circuit: string | null;
  value: number;
  ts: string;
}

/**
 * Outage detection for smart poles: during on-hours a monitored pole drawing
 * no power is an outage; during off-hours a pole drawing power is a
 * day-burner. Outages sharing a circuit roll up into one circuit-fault
 * incident (likely feeder/contactor, not N lamps). Poles without telemetry
 * are covered by night-patrol inspections and citizen reports instead.
 */
@Injectable()
export class LightingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LightingService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DbService,
    private readonly rules: RulesService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.sweep().catch((err) => this.logger.warn(`Lighting sweep failed: ${err}`));
    }, SWEEP_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** On-hours window (local server time), overridable for testing/latitude. */
  private isOnHours(): boolean {
    const start = Number(process.env.LIGHTING_ON_START ?? 19);
    const end = Number(process.env.LIGHTING_ON_END ?? 7);
    const hour = new Date().getHours();
    return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
  }

  async status() {
    const rows = await this.monitoredPoles();
    return {
      onHours: this.isOnHours(),
      poles: rows.map((p) => ({
        code: p.code,
        circuit: p.circuit,
        powerW: p.value,
        at: p.ts,
        lit: p.value > POWER_THRESHOLD_W,
      })),
    };
  }

  private async monitoredPoles(): Promise<PoleReading[]> {
    const result = await this.db.query<PoleReading>(
      `SELECT a.id, a.code, a.attributes->>'circuitId' AS circuit, r.value, r.ts
       FROM assets a
       JOIN sensors s ON s.asset_id = a.id AND s.kind = 'power_draw'
       JOIN LATERAL (
         SELECT value, ts FROM readings WHERE sensor_id = s.id ORDER BY ts DESC LIMIT 1
       ) r ON TRUE
       WHERE a.type_id = 'light_pole' AND a.status = 'active'
         AND r.ts > now() - ($1 || ' minutes')::interval`,
      [FRESH_MINUTES],
    );
    return result.rows;
  }

  async sweep(): Promise<{ outages: string[]; circuitFaults: string[]; dayBurners: string[] }> {
    const poles = await this.monitoredPoles();
    const onHours = this.isOnHours();
    const outages: string[] = [];
    const circuitFaults: string[] = [];
    const dayBurners: string[] = [];

    if (onHours) {
      const dark = poles.filter((p) => p.value <= POWER_THRESHOLD_W);
      const byCircuit = new Map<string, PoleReading[]>();
      for (const p of dark) {
        const key = p.circuit ?? `__none_${p.code}`;
        byCircuit.set(key, [...(byCircuit.get(key) ?? []), p]);
      }
      for (const [circuit, circuitPoles] of byCircuit) {
        if (!circuit.startsWith('__none_') && circuitPoles.length >= CIRCUIT_FAULT_MIN) {
          // Stable title (count lives in detail) so dedup and healing work
          // even as the number of dark poles changes between sweeps.
          await this.rules.openModuleIncident({
            severity: 'warning',
            title: `Circuit fault: ${circuit} poles dark during on-hours`,
            detail: {
              module: 'lighting',
              darkPoles: circuitPoles.length,
              poles: circuitPoles.map((p) => p.code),
            },
          });
          circuitFaults.push(circuit);
        } else {
          for (const p of circuitPoles) {
            await this.rules.openModuleIncident({
              severity: 'warning',
              title: `Street light out: ${p.code}`,
              assetId: p.id,
              detail: { module: 'lighting', circuit: p.circuit },
            });
            outages.push(p.code);
          }
        }
      }
      // Lit poles heal their own outage incidents; recovered circuits heal
      // their circuit-fault incident.
      for (const p of poles.filter((x) => x.value > POWER_THRESHOLD_W)) {
        await this.rules.resolveModuleIncidentByTitle(`Street light out: ${p.code}`);
        await this.rules.resolveModuleIncidentByTitle(`Day-burner: ${p.code}`);
      }
      const allCircuits = new Set(poles.map((p) => p.circuit).filter(Boolean) as string[]);
      for (const circuit of allCircuits) {
        const darkCount = byCircuit.get(circuit)?.length ?? 0;
        if (darkCount < CIRCUIT_FAULT_MIN) {
          await this.rules.resolveModuleIncidentByTitle(
            `Circuit fault: ${circuit} poles dark during on-hours`,
          );
        }
      }
    } else {
      for (const p of poles) {
        if (p.value > POWER_THRESHOLD_W) {
          await this.rules.openModuleIncident({
            severity: 'info',
            title: `Day-burner: ${p.code}`,
            assetId: p.id,
            detail: { module: 'lighting', powerW: p.value },
          });
          dayBurners.push(p.code);
        } else {
          await this.rules.resolveModuleIncidentByTitle(`Day-burner: ${p.code}`);
        }
      }
    }
    return { outages, circuitFaults, dayBurners };
  }
}

@Controller('lighting')
class LightingController {
  constructor(private readonly lighting: LightingService) {}

  @RequirePermission('lighting', 'read')
  @Get('status')
  status() {
    return this.lighting.status();
  }

  /** Manual trigger; the same sweep also runs every 10 minutes. */
  @RequirePermission('lighting', 'manage')
  @Post('sweep')
  sweep() {
    return this.lighting.sweep();
  }
}

@Module({
  imports: [RulesModule],
  controllers: [LightingController],
  providers: [LightingService],
})
export class LightingModule {}
