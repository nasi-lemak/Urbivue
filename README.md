# Urbivue

**Urbivue** is a unified city infrastructure management system: one platform for registering,
monitoring, maintaining, and reporting on the physical assets a municipality operates every day.

Instead of building ten disconnected apps, Urbivue is designed as a **shared asset-management
core** with pluggable **domain modules**:

| Module | Status | What it manages |
|---|---|---|
| Drain Management | 🟢 In progress | Drainage network, blockages, cleaning & condition |
| Flood Monitoring | 🟢 In progress | Water-level/rain sensors, flood zones, real-time alerts |
| Water Pumps | ⚪ Phase 2 | Pump stations, run telemetry, flood-response interlocks |
| Slope Monitoring | ⚪ Phase 2 | Slopes/retaining walls, movement sensors, landslide risk |
| Street Lighting | ⚪ Phase 3 | Poles & luminaires, outage detection, energy usage |
| Waste Bins | ⚪ Phase 3 | Bin inventory, fill levels, collection routing |
| Traffic Counters | ⚪ Phase 3 | Count stations, traffic time-series & analytics |
| Tree Management | ⚪ Phase 4 | Tree inventory, health & risk inspections, pruning |
| Public Toilets | ⚪ Phase 4 | Facility registry, cleaning schedules, service quality |
| Accessible Facilities | ⚪ Phase 4 | Ramps, tactile paving, accessible amenities & audits |

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

Remaining for Phase 1: recurring schedules, continuous aggregates for dashboard charts, and
richer notification channels (email/Telegram).
