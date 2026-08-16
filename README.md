# Urbivue

**Urbivue** is a unified city infrastructure management system: one platform for registering,
monitoring, maintaining, and reporting on the physical assets a municipality operates every day.

Instead of building ten disconnected apps, Urbivue is designed as a **shared asset-management
core** with pluggable **domain modules**:

| Module | Status | What it manages |
|---|---|---|
| Drain Management | 🟢 In progress | Drainage network, blockages, cleaning & condition |
| Flood Monitoring | 🟢 In progress | Water-level/rain sensors, flood zones, real-time alerts |
| Water Pumps | 🟢 In progress | Pump stations, run telemetry, flood-response interlocks |
| Slope Monitoring | 🟢 In progress | Slopes/retaining walls, movement sensors, landslide risk |
| Street Lighting | 🟢 In progress | Poles & luminaires, outage detection, energy usage |
| Waste Bins | 🟢 In progress | Bin inventory, fill levels, collection routing |
| Traffic Counters | 🟢 In progress | Count stations, traffic time-series & analytics |
| Tree Management | 🟢 In progress | Tree inventory, health & risk inspections, pruning |
| Public Toilets | 🟢 In progress | Facility registry, cleaning schedules, service quality |
| Accessible Facilities | 🟢 In progress | Ramps, tactile paving, accessible amenities & audits |

Every module reuses the same platform services — geospatial asset registry, sensor telemetry
pipeline, inspections & work orders, alerting, citizen reports, and a map-first dashboard — so
each new module is mostly configuration plus a thin layer of domain logic.

## Documentation

Planning and design documents live in [`docs/`](docs/):

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture, tech stack, and the
  platform/module design that makes ten features tractable.
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — core entities shared by all modules and the
  per-module extensions.
- [`docs/MODULES.md`](docs/MODULES.md) — functional specification for each of the ten modules.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phased implementation plan with milestones and
  acceptance criteria.

## Getting started (development)

Prerequisites: Node 22+, pnpm 10+, Docker.

```bash
pnpm install
pnpm build                                  # build shared package + apps

docker compose -f infra/docker/docker-compose.yml up -d db   # PostGIS + TimescaleDB
pnpm db:migrate                             # apply SQL migrations
pnpm db:seed                                # admin user + demo asset types/assets

pnpm dev:api                                # NestJS API on :3000
pnpm dev:web                                # Vite dev server on :5173 (proxies /api)
```

Sign in at http://localhost:5173 with `admin@urbivue.local` / `urbivue-admin`
(override via `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`; see `.env.example`).

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check` — all run in CI,
which also applies migrations + seed against a live PostGIS/Timescale service container.

## Repository layout

```
apps/api        NestJS backend — platform services (auth/RBAC, asset registry, audit)
apps/web        React + MapLibre ops dashboard shell
packages/shared Zod schemas, asset-type registry, permission model (shared api <-> web)
infra/docker    Docker Compose: PostGIS+Timescale, Redis, Mosquitto (MQTT)
docs/           Architecture, data model, module specs, roadmap
```

### Try the storm demo

With the stack running (`db` + `mqtt` containers, API, web):

```bash
pnpm --filter @urbivue/simulator start storm 60    # rainfall + river levels ramp up
```

Watch the incidents panel: rainfall and water-level warnings fire first, then critical
"DANGER" incidents as levels pass 2.5 m. Run `... start calm 20` afterwards and the
threshold incidents auto-resolve as levels drop. `... start silence 60` exercises the
silent-sensor (absence) rule. Devices without MQTT can POST to `/api/ingest` with the
`X-Ingest-Key` header (see `.env.example`).

## Status

**Phase 0 (platform foundation) is implemented**: monorepo scaffold with CI, PostGIS/Timescale
database with migrations and seed, JWT auth with role-based permissions and audit logging, the
geospatial asset registry (typed JSONB attributes, spatial queries, GeoJSON import with dry-run
validation and export, soft decommissioning), and the map-first web shell with per-type layers
and an asset detail editor.

**Phase 1 (telemetry, rules & the first two modules) is in progress.** Done so far: sensor
registry and readings hypertable (TimescaleDB), MQTT + keyed HTTP ingestion, the rules engine
(threshold with hysteresis, rate-of-change, sensor-silence absence rules) firing deduplicated
incidents with acknowledge/resolve workflow and auto-resolution, default flood alert rules,
drainage + flood asset types with seeded demo network, the sensor simulator (calm/storm/silence
scenarios), and a live ops panel (incidents + work orders) in the web shell.

Inspections & work orders are in: per-asset-type checklist templates defined by modules
(drain condition check, station check), validated submissions that update asset condition and
map attributes, and the full work-order lifecycle (open → assigned → in progress → done →
verified, with rework and cancellation) with per-transition timestamps. The flagship drainage
flow works end to end: an inspection reporting ≥70 % blockage auto-opens a prioritized cleaning
work order (deduplicated against existing active ones) that a crew can take, start, complete,
and a supervisor verify — from the asset drawer's "New inspection" form to the ops panel.

Recurring schedules and notifications round Phase 1 out: enabled schedules generate
deduplicated preventive work orders per asset on their interval (seeded: 90-day drain
inspections, 180-day station servicing — run manually via `POST /api/schedules/run` or let the
periodic sweep handle it), sensor readings can be served bucketed by hour/day for charts, and
alerts fan out through pluggable channels — log always, plus webhook (`ALERT_WEBHOOK_URL`) and
Telegram (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`) when configured.

**Phase 1 is complete. Phase 2 is in progress**: the Water Pumps module (station/pump
hierarchy, run/current/sump telemetry, a readiness board at `GET /api/pumps/readiness`, and a
flood interlock that opens a critical incident when no pump is running during a water-level
alert), the Slope Monitoring module (tilt threshold + rate-of-change and piezometer rules, plus
a rain-correlation watch that flags high-risk slopes during intense rainfall), an in-process
platform event bus powering those cross-module reactions, and the citizen reports service —
public intake at `POST /api/public/reports` with spatial de-duplication (50 m) and
nearest-asset matching, anonymous status lookup, and a staff triage queue (third ops-panel tab)
that can turn a report into a prioritized work order. Remaining for Phase 2: report photos,
zone-scoped interlocks, and the public map/report form UI (Phase 4 portal).

**Phase 3 is in progress** — the three device-fleet modules are live: Street Lighting (smart
poles report power draw; a periodic sweep detects outages during on-hours and day-burners
during off-hours, rolls three-plus dark poles on one circuit into a single circuit-fault
incident, and self-heals when power returns; unmonitored poles fall back to night-patrol
inspections and citizen reports), Waste Bins (fill-level rules plus
`GET /api/bins/collection-list` — bins over threshold grouped by stream and ordered
nearest-neighbor from the depot with leg distances), and Traffic Counters
(`GET /api/traffic/stats/<counter>` hourly profiles and daily totals, plus a public open-data
API: station list and JSON/CSV count exports). Remaining for Phase 3: map
clustering/vector-tile performance for large fleets, and bulk-import ergonomics.

**Phase 4 is in progress — all ten modules are now live.** Tree Management (arborist risk
assessments derive health/risk ratings, high-risk trees auto-escalate to arborist work orders,
and `POST /api/trees/storm-campaign` generates emergency assessments for every high-risk tree
after a storm), Public Toilets (cleaning check-ins stamp `lastCleanedAt`, broken fixtures open
repair orders, and the public finder at `GET /api/public/toilets` shows hours, accessible
fixtures, last-cleaned time, and community star ratings via
`POST /api/public/toilets/:id/rating`), and Accessible Facilities (compliance audits derive
compliant / minor-issues / non-compliant status, failures land in the remediation backlog at
`GET /api/accessibility/backlog` with their work orders, and `GET /api/public/accessibility`
serves the public accessibility layer). A public flood feed (`GET /api/public/flood-status`)
classifies every station against the configured thresholds for the portal's advisory banner.

Remaining for Phase 4: the public portal web UI (map + report form over the existing public
API). Deferred niceties: Timescale continuous aggregates, email notifications, offline-queueing
for crew forms, and map clustering for large fleets.
