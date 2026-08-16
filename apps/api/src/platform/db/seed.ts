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
  /** Linked in a second pass, after all assets exist. */
  parentCode?: string;
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

  // Water pumps: one station with two pumps at the river confluence.
  {
    typeId: 'pump_station',
    code: 'PS-001',
    name: 'Masjid Jamek flood pump station',
    geometry: { type: 'Point', coordinates: [101.6949, 3.1493] },
    attributes: { sumpCapacityM3: 120, powerFeed: 'grid_plus_generator', autoStartLevelM: 1.2 },
  },
  {
    typeId: 'pump',
    code: 'PMP-001',
    name: 'Pump 1 (duty)',
    geometry: { type: 'Point', coordinates: [101.69488, 3.14928] },
    attributes: { ratedFlowLps: 500, headM: 8, powerKw: 55, driveType: 'electric' },
    parentCode: 'PS-001',
  },
  {
    typeId: 'pump',
    code: 'PMP-002',
    name: 'Pump 2 (standby)',
    geometry: { type: 'Point', coordinates: [101.69492, 3.14932] },
    attributes: { ratedFlowLps: 500, headM: 8, powerKw: 55, driveType: 'diesel' },
    parentCode: 'PS-001',
  },

  // Slope monitoring: a high-risk cut slope above the city.
  {
    typeId: 'slope',
    code: 'SLP-001',
    name: 'Bukit Nanas cut slope',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [101.7005, 3.1515],
          [101.7025, 3.1515],
          [101.7025, 3.15],
          [101.7005, 3.15],
          [101.7005, 3.1515],
        ],
      ],
    },
    attributes: { heightM: 22, angleDeg: 55, riskRanking: 'high', geology: 'weathered granite' },
  },
];

/** Sensors attach to assets by code. */
const SEED_SENSORS = [
  { externalId: 'WL-001', kind: 'water_level', unit: 'm', assetCode: 'MS-001' },
  { externalId: 'WL-002', kind: 'water_level', unit: 'm', assetCode: 'MS-002' },
  { externalId: 'RG-001', kind: 'rainfall', unit: 'mm/h', assetCode: 'MS-001' },
  { externalId: 'PMP-001-RUN', kind: 'run_status', unit: '', assetCode: 'PMP-001' },
  { externalId: 'PMP-002-RUN', kind: 'run_status', unit: '', assetCode: 'PMP-002' },
  { externalId: 'PMP-001-AMP', kind: 'current', unit: 'A', assetCode: 'PMP-001' },
  { externalId: 'SMP-001', kind: 'sump_level', unit: 'm', assetCode: 'PS-001' },
  { externalId: 'TLT-001', kind: 'tilt', unit: 'deg', assetCode: 'SLP-001' },
  { externalId: 'PZ-001', kind: 'piezometer', unit: 'kPa', assetCode: 'SLP-001' },
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
  {
    module: 'pumps',
    key: 'pumps.overcurrent',
    name: 'Pump overcurrent',
    kind: 'threshold',
    sensorKind: 'current',
    params: { operator: 'gt', value: 80, clear: 70 },
    severity: 'warning',
  },
  {
    module: 'pumps',
    key: 'pumps.sump_high_high',
    name: 'Sump level high-high',
    kind: 'threshold',
    sensorKind: 'sump_level',
    params: { operator: 'gt', value: 2.0, clear: 1.6 },
    severity: 'critical',
  },
  {
    module: 'slopes',
    key: 'slopes.tilt_alert',
    name: 'Slope tilt threshold',
    kind: 'threshold',
    sensorKind: 'tilt',
    params: { operator: 'gt', value: 2.0, clear: 1.5 },
    severity: 'warning',
  },
  {
    module: 'slopes',
    key: 'slopes.tilt_rapid',
    name: 'Rapid slope movement',
    kind: 'rate_of_change',
    sensorKind: 'tilt',
    params: { delta: 0.5, windowMinutes: 1440 },
    severity: 'critical',
  },
  {
    module: 'slopes',
    key: 'slopes.piezo_high',
    name: 'High groundwater pressure',
    kind: 'threshold',
    sensorKind: 'piezometer',
    params: { operator: 'gt', value: 50, clear: 40 },
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
  {
    module: 'pumps',
    key: 'pumps.station_check',
    name: 'Pump station check & test run',
    assetTypeId: 'pump_station',
    templateKey: 'pumps.station_check',
    intervalDays: 30,
    priority: 'high',
  },
  {
    module: 'slopes',
    key: 'slopes.geotech_visual',
    name: 'Slope visual inspection',
    assetTypeId: 'slope',
    templateKey: 'slopes.geotech_visual',
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

  for (const a of DEMO_ASSETS.filter((x) => x.parentCode)) {
    await pool.query(
      `UPDATE assets SET parent_id = (SELECT id FROM assets WHERE code = $2)
       WHERE code = $1 AND parent_id IS NULL`,
      [a.code, a.parentCode],
    );
  }

  for (const s of SEED_SENSORS) {
    await pool.query(
      `INSERT INTO sensors (asset_id, kind, external_id, unit, geom)
       SELECT a.id, $2, $3, $4, ST_PointOnSurface(a.geom)
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
