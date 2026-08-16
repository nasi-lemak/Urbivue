import { Injectable } from '@nestjs/common';
import type { IngestReading } from '@urbivue/shared';
import { DbService } from '../db/db.service';
import { RulesService, SensorRow } from '../rules/rules.service';

export interface IngestResult {
  accepted: number;
  rejected: { sensorExternalId: string; reason: string }[];
}

@Injectable()
export class IngestService {
  constructor(
    private readonly db: DbService,
    private readonly rules: RulesService,
  ) {}

  async ingestBatch(readings: IngestReading[]): Promise<IngestResult> {
    const result: IngestResult = { accepted: 0, rejected: [] };
    for (const reading of readings) {
      try {
        await this.ingestOne(reading);
        result.accepted++;
      } catch (err) {
        result.rejected.push({
          sensorExternalId: reading.sensorExternalId,
          reason: (err as Error).message,
        });
      }
    }
    return result;
  }

  async ingestOne(reading: IngestReading): Promise<void> {
    const sensorResult = await this.db.query<SensorRow>(
      'SELECT id, asset_id, kind, external_id, unit FROM sensors WHERE external_id = $1',
      [reading.sensorExternalId],
    );
    const sensor = sensorResult.rows[0];
    if (!sensor) throw new Error(`Unknown sensor '${reading.sensorExternalId}'`);

    const ts = reading.ts ? new Date(reading.ts) : new Date();
    await this.db.query(
      `INSERT INTO readings (sensor_id, ts, value, quality)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (sensor_id, ts) DO NOTHING`,
      [sensor.id, ts.toISOString(), reading.value, reading.quality ?? 'good'],
    );
    await this.db.query(
      `UPDATE sensors SET last_seen_at = GREATEST(COALESCE(last_seen_at, '-infinity'), $2::timestamptz)
       WHERE id = $1`,
      [sensor.id, ts.toISOString()],
    );

    // A sensor that reports again heals its own silence incidents.
    await this.rules.resolveAbsenceIncidents(sensor.id);
    await this.rules.evaluateReading(sensor, reading.value, ts);
  }
}
