/* Development/bootstrap seed: admin user, asset types from the shared
 * registry, and a handful of demo assets (only when the table is empty). */
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { listAssetTypes } from '@urbivue/shared';
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

const DEMO_ASSETS = [
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

  const assetCount = await pool.query('SELECT count(*)::int AS n FROM assets');
  if (assetCount.rows[0].n === 0) {
    for (const a of DEMO_ASSETS) {
      await pool.query(
        `INSERT INTO assets (type_id, code, name, geom, attributes)
         VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326), $5)`,
        [a.typeId, a.code, a.name, JSON.stringify(a.geometry), JSON.stringify(a.attributes)],
      );
    }
    console.log(`Seeded ${DEMO_ASSETS.length} demo assets`);
  }

  await pool.end();
}

if (require.main === module) {
  seed().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
