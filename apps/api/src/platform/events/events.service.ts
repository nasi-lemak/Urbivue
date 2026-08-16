import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { Severity } from '@urbivue/shared';

export interface IncidentOpenedEvent {
  module: string;
  ruleKey?: string;
  severity: Severity;
  title: string;
  sensorId?: string | null;
  assetId?: string | null;
}

/**
 * In-process event bus for cross-module reactions (flood -> pumps readiness,
 * rain -> slope watch, ...). Handlers run async and never propagate errors
 * back to the emitter. Swappable for a broker if modules are ever extracted.
 */
@Injectable()
export class PlatformEventsService {
  private readonly logger = new Logger(PlatformEventsService.name);
  private readonly emitter = new EventEmitter();

  emitIncidentOpened(event: IncidentOpenedEvent): void {
    this.emitter.emit('incident.opened', event);
  }

  onIncidentOpened(handler: (event: IncidentOpenedEvent) => Promise<void> | void): void {
    this.emitter.on('incident.opened', (event: IncidentOpenedEvent) => {
      Promise.resolve(handler(event)).catch((err) =>
        this.logger.warn(`incident.opened handler failed: ${err}`),
      );
    });
  }
}
