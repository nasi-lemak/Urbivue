/* Development/bootstrap seed: admin user, asset types from the shared
 * registry, demo assets for the demo/drainage/flood modules, monitoring
 * sensors, and default flood alert rules. Idempotent: safe to re-run. */
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { listAssetTypes, listInspectionTemplates } from '@urbivue/shared';
import { databaseUrl } from './db.service';

export async function syncAssetTypes(pool: Pool): Promise<void> {
  for (const def of listAssetTypes()) {
    await pool.query(
      `INSERT INTO asset_types (id, module, name, geometry_kind, style)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         module = EXCLUDED.module, name = EXCLUDED.name,
         geometry_kind = EXCLUDED.geometry_kind, style = EXCLUDED.style`,
      [def.id, def.module, def.name, def.geometryKind, JSON.stringify(def.style)],
    );
  }
}

interface SeedAsset {
  typeId: string;
  code: string;
  name: string;
  geometry: Record<string, unknown>;
  attributes: Record<string, unknown>;
}

const DEMO_ASSETS: SeedAsset[] = [
  {
    typeId: 'demo_poi',
    code: 'POI-0001',
    name: 'Merdeka Square',
    geometry: { type: 'Point', coordinates: [101.6932, 3.1478] },
    attributes: { category: 'landmark' },
  },
  {
    typeId: 'demo_poi',
    code: 'POI-0002',
    name: 'KL City Gallery',
    geometry: { type: 'Point', coordinates: [101.6939, 3.1465] },
    attributes: { category: 'building' },
  },
  {
    typeId: 'demo_poi',
    code: 'POI-0003',
    name: 'Central Market',
    geometry: { type: 'Point', coordinates: [101.6953, 3.1459] },
    attributes: { category: 'market', notes: 'High footfall area' },
  },
  {
    typeId: 'demo_area',
    code: 'AREA-0001',
    name: 'Perdana Botanical Gardens',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [101.6805, 3.1445],
          [101.687, 3.1445],
          [101.687, 3.139],
          [101.6805, 3.139],
          [101.6805, 3.1445],
        ],
      ],
    },
    attributes: { kind: 'park' },
  },

  // Drainage network sample: inlet -> manhole -> river outfall.
  {
    typeId: 'drain_node',
    code: 'DRN-N001',
    name: 'Inlet, Jalan Tun Perak',
    geometry: { type: 'Point', coordinates: [101.6965, 3.1495] },
    attributes: { kind: 'inlet' },
  },
  {
    typeId: 'drain_node',
    code: 'DRN-N002',
    name: 'Manhole, Lebuh Ampang',
    geometry: { type: 'Point', coordinates: [101.6975, 3.1478] },
    attributes: { kind: 'manhole', invertLevelM: 31.2 },
  },
  {
    typeId: 'drain_node',
    code: 'DRN-N003',
    name: 'Outfall, Klang River',
    geometry: { type: 'Point', coordinates: [101.6958, 3.1462] },
    attributes: { kind: 'outfall' },
  },
  {
    typeId: 'drain_line',
    code: 'DRN-L001',
    name: 'Tun Perak trunk drain (upper)',
    geometry: {
      type: 'LineString',
      coordinates: [
        [101.6965, 3.1495],
        [101.6975, 3.1478],
      ],
    },
    attributes: {
      shape: 'box_culvert',
      widthM: 1.2,
      depthM: 1.5,
      material: 'concrete',
      upstreamNodeCode: 'DRN-N001',
      downstreamNodeCode: 'DRN-N002',
      blockagePct: 20,
    },
  },
  {
    typeId: 'drain_line',
    code: 'DRN-L002',
    name: 'Tun Perak trunk drain (lower)',
    geometry: {
      type: 'LineString',
      coordinates: [
        [101.6975, 3.1478],
        [101.6958, 3.1462],
      ],
    },
    attributes: {
      shape: 'box_culvert',
      widthM: 1.2,
      depthM: 1.8,
      material: 'concrete',
      upstreamNodeCode: 'DRN-N002',
      downstreamNodeCode: 'DRN-N003',
      blockagePct: 65,
    },
  },

  // Flood monitoring: risk zone + two river stations.
  {
    typeId: 'flood_zone',
    code: 'FZ-001',
    name: 'Masjid Jamek low-lying zone',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [101.694, 3.1485],
          [101.698, 3.1485],
          [101.698, 3.145],
          [101.694, 3.145],
          [101.694, 3.1485],
        ],
      ],
    },
    attributes: { riskClass: 'high', basis: 'historical' },
  },
  {
    typeId: 'monitoring_station',
    code: 'MS-001',
    name: 'Klang River @ Masjid Jamek',
    geometry: { type: 'Point', coordinates: [101.6957, 3.1489] },
    attributes: { stationKind: 'combined', waterway: 'Klang River' },
  },
  {
    typeId: 'monitoring_station',
    code: 'MS-002',
    name: 'Gombak River @ Dang Wangi',
    geometry: { type: 'Point', coordinates: [101.698, 3.1535] },
    attributes: { stationKind: 'water_level', waterway: 'Gombak River' },
  },
];

/** Sensors attach to monitoring-station assets by code. */
const SEED_SENSORS = [
  { externalId: 'WL-001', kind: 'water_level', unit: 'm', assetCode: 'MS-001' },
  { externalId: 'WL-002', kind: 'water_level', unit: 'm', assetCode: 'MS-002' },
  { externalId: 'RG-001', kind: 'rainfall', unit: 'mm/h', assetCode: 'MS-001' },
];

const SEED_ALERT_RULES = [
  {
    module: 'flood',
    key: 'flood.level_warning',
    name: 'Water level warning',
    kind: 'threshold',
    sensorKind: 'water_level',
    params: { operator: 'gt', value: 1.5, clear: 1.2 },
    severity: 'warning',
  },
  {
    module: 'flood',
    key: 'flood.level_danger',
    name: 'Water level DANGER',
    kind: 'threshold',
    sensorKind: 'water_level',
    params: { operator: 'gt', value: 2.5, clear: 2.0 },
    severity: 'critical',
  },
  {
    module: 'flood',
    key: 'flood.rain_intense',
    name: 'Intense rainfall',
    kind: 'threshold',
    sensorKind: 'rainfall',
    params: { operator: 'gt', value: 30, clear: 20 },
    severity: 'warning',
  },
  {
    module: 'flood',
    key: 'flood.level_rapid_rise',
    name: 'Rapid water level rise',
    kind: 'rate_of_change',
    sensorKind: 'water_level',
    params: { delta: 1.0, windowMinutes: 30 },
    severity: 'warning',
  },
  {
    module: 'flood',
    key: 'flood.sensor_silent',
    name: 'Water level sensor silent',
    kind: 'absence',
    sensorKind: 'water_level',
    params: { minutes: 10 },
    severity: 'warning',
  },
];

const SEED_SCHEDULES = [
  {
    module: 'drainage',
    key: 'drainage.routine_inspection',
    name: 'Routine drain inspection',
    assetTypeId: 'drain_line',
    templateKey: 'drainage.condition',
    intervalDays: 90,
    priority: 'medium',
  },
  {
    module: 'flood',
    key: 'flood.station_service',
    name: 'Monitoring station service',
    assetTypeId: 'monitoring_station',
    templateKey: 'flood.station_check',
    intervalDays: 180,
    priority: 'medium',
  },
];

async function seed() {
  const pool = new Pool({ connectionString: databaseUrl() });

  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@urbivue.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'urbivue-admin';
  const existing = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (!existing.rowCount) {
    await pool.query(
      `INSERT INTO users (email, display_name, password_hash, role)
       VALUES ($1, $2, $3, 'admin')`,
      [email, 'Administrator', bcrypt.hashSync(password, 10)],
    );
    console.log(`Created admin user ${email} (password from SEED_ADMIN_PASSWORD)`);
  }

  await syncAssetTypes(pool);
  console.log('Asset types synced from shared registry');

  for (const t of listInspectionTemplates()) {
    await pool.query(
      `INSERT INTO inspection_templates (key, asset_type_id, name, items)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET
         asset_type_id = EXCLUDED.asset_type_id, name = EXCLUDED.name, items = EXCLUDED.items`,
      [t.key, t.assetTypeId, t.name, JSON.stringify(t.items)],
    );
  }
  console.log(
    `Inspection templates ensured: ${listInspectionTemplates()
      .map((t) => t.key)
      .join(', ')}`,
  );

  let newAssets = 0;
  for (const a of DEMO_ASSETS) {
    const result = await pool.query(
      `INSERT INTO assets (type_id, code, name, geom, attributes)
       VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326), $5)
       ON CONFLICT (code) DO NOTHING`,
      [a.typeId, a.code, a.name, JSON.stringify(a.geometry), JSON.stringify(a.attributes)],
    );
    newAssets += result.rowCount ?? 0;
  }
  console.log(`Assets: ${newAssets} inserted, ${DEMO_ASSETS.length - newAssets} already present`);

  for (const s of SEED_SENSORS) {
    await pool.query(
      `INSERT INTO sensors (asset_id, kind, external_id, unit, geom)
       SELECT a.id, $2, $3, $4, a.geom
       FROM assets a WHERE a.code = $1
       ON CONFLICT (external_id) DO NOTHING`,
      [s.assetCode, s.kind, s.externalId, s.unit],
    );
  }
  console.log(`Sensors ensured: ${SEED_SENSORS.map((s) => s.externalId).join(', ')}`);

  for (const r of SEED_ALERT_RULES) {
    await pool.query(
      `INSERT INTO alert_rules (module, key, name, kind, sensor_kind, params, severity)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (key) DO UPDATE SET
         name = EXCLUDED.name, kind = EXCLUDED.kind, sensor_kind = EXCLUDED.sensor_kind,
         params = EXCLUDED.params, severity = EXCLUDED.severity`,
      [r.module, r.key, r.name, r.kind, r.sensorKind, JSON.stringify(r.params), r.severity],
    );
  }
  console.log(`Alert rules ensured: ${SEED_ALERT_RULES.map((r) => r.key).join(', ')}`);

  for (const s of SEED_SCHEDULES) {
    await pool.query(
      `INSERT INTO schedules (module, key, name, asset_type_id, template_key, interval_days, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (key) DO UPDATE SET
         name = EXCLUDED.name, asset_type_id = EXCLUDED.asset_type_id,
         template_key = EXCLUDED.template_key, interval_days = EXCLUDED.interval_days,
         priority = EXCLUDED.priority`,
      [s.module, s.key, s.name, s.assetTypeId, s.templateKey, s.intervalDays, s.priority],
    );
  }
  console.log(`Schedules ensured: ${SEED_SCHEDULES.map((s) => s.key).join(', ')}`);

  await pool.end();
}

if (require.main === module) {
  seed().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
