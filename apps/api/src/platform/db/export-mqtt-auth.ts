/* Export mosquitto auth files from the sensor registry.
 *
 *   pnpm --filter @urbivue/api export-mqtt-auth <outDir> <apiPassword>
 *
 * Writes:
 *   <outDir>/passwd  one entry per unrevoked device (username = externalId)
 *                    plus the 'urbivue-api' subscriber account
 *   <outDir>/acl     devices may only publish urbivue/ingest/<their own id>;
 *                    the API account may read the whole ingest tree
 *
 * Re-run after issuing, rotating, or revoking device keys, then reload
 * mosquitto. The API connects with MQTT_USERNAME/MQTT_PASSWORD env vars.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import { databaseUrl } from './db.service';
import { mosquittoHash } from '../telemetry/device-keys';

const API_USERNAME = 'urbivue-api';

async function main() {
  const outDir = process.argv[2];
  const apiPassword = process.argv[3];
  if (!outDir || !apiPassword) {
    console.error('usage: export-mqtt-auth <outDir> <apiPassword>');
    process.exit(2);
  }

  const pool = new Pool({ connectionString: databaseUrl() });
  const sensors = await pool.query<{ external_id: string; mqtt_password_hash: string }>(
    `SELECT external_id, mqtt_password_hash FROM sensors
     WHERE mqtt_password_hash IS NOT NULL AND key_revoked_at IS NULL
     ORDER BY external_id`,
  );
  await pool.end();

  fs.mkdirSync(outDir, { recursive: true });

  const passwd = [
    `${API_USERNAME}:${mosquittoHash(apiPassword)}`,
    ...sensors.rows.map((s) => `${s.external_id}:${s.mqtt_password_hash}`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'passwd'), passwd, { mode: 0o600 });

  const acl = [
    '# Devices: publish only to their own ingest topic (username substitution).',
    'pattern write urbivue/ingest/%u',
    '',
    '# The platform subscriber reads the whole ingest tree.',
    `user ${API_USERNAME}`,
    'topic read urbivue/ingest/#',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'acl'), acl, { mode: 0o644 });

  console.log(`Wrote ${sensors.rowCount} device credential(s) + API account to ${outDir}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
