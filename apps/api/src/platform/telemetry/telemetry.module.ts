import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { MqttIngestService } from './mqtt.service';
import { SensorsController } from './sensors.controller';

@Module({
  imports: [RulesModule],
  controllers: [IngestController, SensorsController],
  providers: [IngestService, MqttIngestService],
})
export class TelemetryModule {}
