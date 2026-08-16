/**
 * Sensor simulator: publishes readings for the seeded demo sensors over MQTT
 * so every Phase 1 flow (ingestion, rules, incidents) is demoable and
 * testable without hardware.
 *
 * Usage: pnpm --filter @urbivue/simulator start [scenario] [durationSec] [stepMs]
 *   scenario    calm | storm | silence   (default: calm)
 *   durationSec how long to run          (default: 60)
 *   stepMs      publish interval         (default: 2000)
 *
 * Scenarios:
 *   calm     dry weather: low stable water levels, no rain
 *   storm    rainfall ramps to ~45 mm/h; river levels rise past the seeded
 *            warning (1.5 m) and danger (2.5 m) thresholds
 *   silence  WL-002 stops reporting mid-run (exercises the absence rule)
 */
import * as mqtt from 'mqtt';

const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const TOPIC_PREFIX = 'urbivue/ingest/';

const scenario = process.argv[2] ?? 'calm';
const durationSec = Number(process.argv[3] ?? 60);
const stepMs = Number(process.argv[4] ?? 2000);

if (!['calm', 'storm', 'silence'].includes(scenario)) {
  console.error(`Unknown scenario '${scenario}' (expected calm | storm | silence)`);
  process.exit(1);
}

const noise = (amplitude: number) => (Math.random() - 0.5) * amplitude;

/** progress p in [0,1] -> value per sensor */
function values(p: number): Record<string, number | null> {
  switch (scenario) {
    case 'storm':
      return {
        'RG-001': Math.max(0, 45 * Math.min(1, p * 1.5) + noise(4)),
        'WL-001': 0.4 + 2.6 * p + noise(0.05),
        'WL-002': 0.35 + 2.2 * p + noise(0.05),
      };
    case 'silence':
      return {
        'RG-001': Math.max(0, noise(0.5)),
        'WL-001': 0.4 + noise(0.06),
        'WL-002': p < 0.3 ? 0.35 + noise(0.06) : null, // goes silent at 30%
      };
    default: // calm
      return {
        'RG-001': Math.max(0, noise(0.5)),
        'WL-001': 0.4 + noise(0.06),
        'WL-002': 0.35 + noise(0.06),
      };
  }
}

async function main() {
  const client = await mqtt.connectAsync(MQTT_URL, { connectTimeout: 5000 });
  console.log(`Simulator connected to ${MQTT_URL} — scenario '${scenario}' for ${durationSec}s`);

  const steps = Math.max(1, Math.floor((durationSec * 1000) / stepMs));
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    const snapshot = values(p);
    for (const [externalId, value] of Object.entries(snapshot)) {
      if (value === null) continue;
      await client.publishAsync(
        `${TOPIC_PREFIX}${externalId}`,
        JSON.stringify({ value: Number(value.toFixed(3)) }),
      );
    }
    const line = Object.entries(snapshot)
      .map(([k, v]) => `${k}=${v === null ? 'SILENT' : v.toFixed(2)}`)
      .join('  ');
    console.log(`[${(p * 100).toFixed(0).padStart(3)}%] ${line}`);
    if (i < steps) await new Promise((r) => setTimeout(r, stepMs));
  }

  await client.endAsync();
  console.log('Simulation complete');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
