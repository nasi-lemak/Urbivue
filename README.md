# Urbivue

**Urbivue** is a unified city infrastructure management system: one platform for registering,
monitoring, maintaining, and reporting on the physical assets a municipality operates every day.

Instead of building ten disconnected apps, Urbivue is designed as a **shared asset-management
core** with pluggable **domain modules**:

| Module | Status | What it manages |
|---|---|---|
| Drain Management | 🟡 Phase 1 | Drainage network, blockages, cleaning & condition |
| Flood Monitoring | 🟡 Phase 1 | Water-level/rain sensors, flood zones, real-time alerts |
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

## Status

**Phase 0 (platform foundation) is implemented**: monorepo scaffold with CI, PostGIS/Timescale
database with migrations and seed, JWT auth with role-based permissions and audit logging, the
geospatial asset registry (typed JSONB attributes, spatial queries, GeoJSON import with dry-run
validation and export, soft decommissioning), and the map-first web shell with per-type layers
and an asset detail editor. Next up per the roadmap: Phase 1 — telemetry pipeline, rules &
alerting, and the Drain Management + Flood Monitoring modules.
