import { z } from 'zod';

/** Well-known sensor kinds; kept as open strings in the DB for extensibility. */
export const SENSOR_KINDS = [
  'water_level',
  'rainfall',
  'fill_level',
  'tilt',
  'piezometer',
  'current',
  'flow',
  'run_status',
  'sump_level',
  'power_draw',
  'vehicle_count',
  'occupancy',
] as const;
export type SensorKind = (typeof SENSOR_KINDS)[number];

export const SEVERITIES = ['info', 'warning', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const INCIDENT_STATUSES = ['open', 'acknowledged', 'resolved'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const RULE_KINDS = ['threshold', 'rate_of_change', 'absence'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const thresholdParamsSchema = z.object({
  operator: z.enum(['gt', 'lt']),
  value: z.number(),
  /** Optional hysteresis: auto-resolve only once the value passes this level. */
  clear: z.number().optional(),
});
export type ThresholdParams = z.infer<typeof thresholdParamsSchema>;

export const rateOfChangeParamsSchema = z.object({
  /** Absolute change that counts as a breach... */
  delta: z.number().positive(),
  /** ...within this look-back window. */
  windowMinutes: z.number().positive(),
});
export type RateOfChangeParams = z.infer<typeof rateOfChangeParamsSchema>;

export const absenceParamsSchema = z.object({
  /** Minutes of silence after which a sensor is considered down. */
  minutes: z.number().positive(),
});
export type AbsenceParams = z.infer<typeof absenceParamsSchema>;

export const ingestReadingSchema = z.object({
  sensorExternalId: z.string().min(1),
  value: z.number().finite(),
  ts: z.string().datetime({ offset: true }).optional(),
  quality: z.enum(['good', 'suspect', 'bad']).optional(),
});
export type IngestReading = z.infer<typeof ingestReadingSchema>;

export const ingestBatchSchema = z.object({
  readings: z.array(ingestReadingSchema).min(1).max(1000),
});
export type IngestBatch = z.infer<typeof ingestBatchSchema>;

/** MQTT topic scheme: readings are published to `urbivue/ingest/<externalId>`. */
export const MQTT_INGEST_TOPIC_PREFIX = 'urbivue/ingest/';
