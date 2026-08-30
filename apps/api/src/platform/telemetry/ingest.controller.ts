import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ingestBatchSchema } from '@urbivue/shared';
import { DbService } from '../db/db.service';
import { IngestService } from './ingest.service';
import { Public } from '../auth/decorators';
import { sha256Hex } from './device-keys';
import { zodParse } from '../zod';

export function ingestKey(): string {
  return process.env.INGEST_API_KEY ?? 'urbivue-dev-ingest';
}

/**
 * HTTP ingestion. Two authentication paths:
 *  - `X-Ingest-Key`: the gateway key (LoRaWAN/vendor bridges posting for
 *    many sensors).
 *  - `X-Device-Key`: a per-device credential — valid only for that one
 *    device's own sensor, and rejected once revoked.
 * The MQTT path (MqttIngestService) is the brokered equivalent; the broker
 * enforces per-device credentials there via its password/ACL files.
 */
@Controller('ingest')
export class IngestController {
  constructor(
    private readonly ingest: IngestService,
    private readonly db: DbService,
  ) {}

  @Public()
  @Post()
  async ingestReadings(
    @Body() body: unknown,
    @Headers('x-ingest-key') gatewayKey?: string,
    @Headers('x-device-key') deviceKey?: string,
  ) {
    const batch = zodParse(ingestBatchSchema, body);

    if (deviceKey) {
      const ids = new Set(batch.readings.map((r) => r.sensorExternalId));
      if (ids.size !== 1) {
        throw new UnauthorizedException('A device key authorizes exactly one sensor');
      }
      const sensor = await this.db.query(
        `SELECT 1 FROM sensors
         WHERE external_id = $1 AND ingest_key_hash = $2 AND key_revoked_at IS NULL`,
        [[...ids][0], sha256Hex(deviceKey)],
      );
      if (!sensor.rowCount) throw new UnauthorizedException('Invalid or revoked device key');
    } else if (gatewayKey !== ingestKey()) {
      throw new UnauthorizedException('Invalid ingest key');
    }

    return this.ingest.ingestBatch(batch.readings);
  }
}
