/*
 * End-to-end smoke test against a running API (default http://localhost:3000).
 * Covers the auth/user-management, citizen-report + photo, sensor
 * provisioning + ingestion, and analytics flows. Run locally or in CI:
 *
 *   node scripts/smoke.mjs
 *
 * Requires a migrated + seeded database. Exits non-zero on first failure.
 */
const API = process.env.API_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@urbivue.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'urbivue-admin';
const INGEST_KEY = process.env.INGEST_API_KEY ?? 'urbivue-dev-ingest';

const run = Date.now().toString(36); // unique suffix per run (idempotent-ish)
let passed = 0;

function ok(name, condition, detail = '') {
  if (!condition) {
    console.error(`FAIL  ${name} ${detail}`);
    process.exit(1);
  }
  passed++;
  console.log(`ok    ${name}`);
}

async function req(path, { method = 'GET', token, body, formData } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers,
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON responses are fine */
  }
  return { status: res.status, json };
}

async function login(email, password) {
  const r = await req('/auth/login', { method: 'POST', body: { email, password } });
  return r.status === 201 || r.status === 200 ? r.json.token : null;
}

// --- health + admin login ---------------------------------------------------
ok('health', (await req('/health')).status === 200);
const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
ok('admin login', !!admin);

// --- user management --------------------------------------------------------
const crewEmail = `crew-${run}@urbivue.local`;
const created = await req('/users', {
  method: 'POST',
  token: admin,
  body: { email: crewEmail, displayName: 'Smoke Crew', role: 'crew', password: 'crew-pass-1' },
});
ok('create user', created.status === 201, JSON.stringify(created.json));
const crewId = created.json.id;

let crew = await login(crewEmail, 'crew-pass-1');
ok('new user can log in', !!crew);
ok('crew cannot list users', (await req('/users', { token: crew })).status === 403);

ok(
  'admin resets password',
  (
    await req(`/users/${crewId}/reset-password`, {
      method: 'POST',
      token: admin,
      body: { password: 'crew-pass-2' },
    })
  ).status === 201,
);
ok('old password rejected', !(await login(crewEmail, 'crew-pass-1')));
crew = await login(crewEmail, 'crew-pass-2');
ok('reset password works', !!crew);

ok(
  'self change-password',
  (
    await req('/auth/change-password', {
      method: 'POST',
      token: crew,
      body: { currentPassword: 'crew-pass-2', newPassword: 'crew-pass-3' },
    })
  ).status === 201,
);
ok('changed password works', !!(await login(crewEmail, 'crew-pass-3')));

const me = await req('/auth/me', { token: admin });
const selfDemote = await req(`/users/${me.json.sub}`, {
  method: 'PATCH',
  token: admin,
  body: { role: 'viewer' },
});
ok('self-demotion blocked', selfDemote.status === 400);

ok(
  'deactivate user',
  (await req(`/users/${crewId}`, { method: 'PATCH', token: admin, body: { active: false } }))
    .status === 200,
);
ok('deactivated user cannot log in', !(await login(crewEmail, 'crew-pass-3')));

// --- citizen report + photo -------------------------------------------------
const report = await req('/public/reports', {
  method: 'POST',
  body: {
    category: 'request_pruning',
    description: `Smoke test report ${run} — overgrown branch`,
    location: { lon: 101.6 + Math.random() * 0.01, lat: 3.2 + Math.random() * 0.01 },
  },
});
ok('citizen report created', report.status === 201, JSON.stringify(report.json));

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const form = new FormData();
form.append('file', new Blob([png], { type: 'image/png' }), 'photo.png');
const photo = await req(`/public/reports/${report.json.id}/photo`, {
  method: 'POST',
  formData: form,
});
ok('public photo upload', photo.status === 201, JSON.stringify(photo.json));

const attachments = await req(`/attachments/citizen_report/${report.json.id}`, { token: admin });
ok('attachment listed', attachments.status === 200 && attachments.json.length === 1);

const badUpload = new FormData();
badUpload.append('file', new Blob([Buffer.from('hello')], { type: 'text/plain' }), 'x.txt');
ok(
  'non-image rejected',
  (await req(`/public/reports/${report.json.id}/photo`, { method: 'POST', formData: badUpload }))
    .status === 400,
);

// --- sensor provisioning + ingestion ---------------------------------------
const sensorId = `SMK-${run}`.toUpperCase();
const sensor = await req('/sensors', {
  method: 'POST',
  token: admin,
  body: { externalId: sensorId, kind: 'flow', unit: 'L/s', location: { lon: 101.7, lat: 3.15 } },
});
ok('sensor registered', sensor.status === 201, JSON.stringify(sensor.json));

const ingest = await req('/ingest', {
  method: 'POST',
  body: { readings: [{ sensorExternalId: sensorId, value: 12.5 }] },
});
// /ingest uses the X-Ingest-Key header, not a bearer token:
const ingest2 = await fetch(`${API}/api/ingest`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': INGEST_KEY },
  body: JSON.stringify({ readings: [{ sensorExternalId: sensorId, value: 12.5 }] }),
});
ok('ingest without key rejected', ingest.status === 401);
ok('ingest with key accepted', ingest2.status === 201);

const sensors = await req('/sensors', { token: admin });
const mine = sensors.json.find((s) => s.externalId === sensorId);
ok('reading visible on sensor', mine && Number(mine.lastValue) === 12.5);

// --- per-device keys ---------------------------------------------------------
const deviceKey = sensor.json.deviceKey;
ok(
  'device key issued once at registration',
  typeof deviceKey === 'string' && deviceKey.startsWith('dk_'),
);

async function deviceIngest(key, extId, value) {
  const res = await fetch(`${API}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Key': key },
    body: JSON.stringify({ readings: [{ sensorExternalId: extId, value }] }),
  });
  return res.status;
}

ok('device-key ingest accepted', (await deviceIngest(deviceKey, sensorId, 13.1)) === 201);
ok('wrong device key rejected', (await deviceIngest('dk_wrong', sensorId, 1)) === 401);
ok(
  'device key cannot post for another sensor',
  (await deviceIngest(deviceKey, 'WL-001', 1)) === 401,
);

const rotated = await req(`/sensors/${sensor.json.id}/rotate-key`, {
  method: 'POST',
  token: admin,
});
ok('key rotation', rotated.status === 201 && rotated.json.deviceKey !== deviceKey);
ok('old key dead after rotation', (await deviceIngest(deviceKey, sensorId, 1)) === 401);
ok('new key works', (await deviceIngest(rotated.json.deviceKey, sensorId, 13.2)) === 201);

ok(
  'key revocation',
  (await req(`/sensors/${sensor.json.id}/revoke-key`, { method: 'POST', token: admin })).status ===
    201,
);
ok('revoked key rejected', (await deviceIngest(rotated.json.deviceKey, sensorId, 1)) === 401);

// --- zones -------------------------------------------------------------------
const zones = await req('/zones?kind=ward', { token: admin });
ok('wards listed', zones.status === 200 && zones.json.length >= 2);

const zoneAssets = await req(`/zones/${zones.json[0].id}/assets`, { token: admin });
ok('zone asset rollup', zoneAssets.status === 200 && zoneAssets.json.length > 0);

const scorecards = await req('/analytics/zones', { token: admin });
ok(
  'zone scorecards',
  scorecards.status === 200 && scorecards.json.every((z) => typeof z.assets === 'number'),
);

const badZone = await req('/zones', {
  method: 'POST',
  token: admin,
  body: {
    code: `SMK-Z-${run}`,
    name: 'Bad geometry',
    kind: 'custom',
    geometry: { type: 'Polygon', coordinates: 'nonsense' },
  },
});
ok('invalid zone geometry rejected', badZone.status === 400 || badZone.status === 500);

// --- analytics ---------------------------------------------------------------
const overview = await req('/analytics/overview', { token: admin });
ok(
  'analytics overview',
  overview.status === 200 &&
    Array.isArray(overview.json.modules) &&
    overview.json.modules.length > 0,
);

console.log(`\nSMOKE OK — ${passed} checks passed`);
