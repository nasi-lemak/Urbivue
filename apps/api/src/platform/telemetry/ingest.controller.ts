import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ingestBatchSchema } from '@urbivue/shared';
import { IngestService } from './ingest.service';
import { Public } from '../auth/decorators';
import { zodParse } from '../zod';

export function ingestKey(): string {
  return process.env.INGEST_API_KEY ?? 'urbivue-dev-ingest';
}

/**
 * HTTP ingestion path for gateways, vendor webhooks, and backfills. Devices
 * authenticate with a shared ingest key rather than a user session; the MQTT
 * path (MqttIngestService) is the equivalent for brokered devices.
 */
@Controller('ingest')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Public()
  @Post()
  ingestReadings(@Body() body: unknown, @Headers('x-ingest-key') key?: string) {
    if (key !== ingestKey()) throw new UnauthorizedException('Invalid ingest key');
    const batch = zodParse(ingestBatchSchema, body);
    return this.ingest.ingestBatch(batch.readings);
  }
}
