import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as mqtt from 'mqtt';
import { MQTT_INGEST_TOPIC_PREFIX, ingestReadingSchema } from '@urbivue/shared';
import { IngestService } from './ingest.service';

/**
 * Subscribes to `urbivue/ingest/<externalId>` and feeds messages into the
 * ingest pipeline. Payload: {"value": 1.23, "ts"?: ISO8601, "quality"?: ...}.
 * Connection failures are non-fatal: the API works without a broker (HTTP
 * ingestion only) and the client keeps retrying in the background.
 */
@Injectable()
export class MqttIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttIngestService.name);
  private client: mqtt.MqttClient | null = null;

  constructor(private readonly ingest: IngestService) {}

  onModuleInit() {
    if (process.env.DISABLE_MQTT === 'true') return;
    const url = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
    this.client = mqtt.connect(url, { reconnectPeriod: 5000, connectTimeout: 5000 });

    this.client.on('connect', () => {
      this.logger.log(`Connected to MQTT broker at ${url}`);
      this.client?.subscribe(`${MQTT_INGEST_TOPIC_PREFIX}#`);
    });
    this.client.on('error', (err) => this.logger.warn(`MQTT: ${err.message}`));
    this.client.on('message', (topic, payload) => {
      this.handleMessage(topic, payload).catch((err) =>
        this.logger.warn(`MQTT message on ${topic} rejected: ${err.message}`),
      );
    });
  }

  private async handleMessage(topic: string, payload: Buffer): Promise<void> {
    const externalId = topic.slice(MQTT_INGEST_TOPIC_PREFIX.length);
    if (!externalId || externalId.includes('/')) {
      throw new Error(`Unexpected topic shape '${topic}'`);
    }
    const body = JSON.parse(payload.toString('utf8'));
    const reading = ingestReadingSchema.parse({ sensorExternalId: externalId, ...body });
    await this.ingest.ingestOne(reading);
  }

  onModuleDestroy() {
    this.client?.end(true);
  }
}
