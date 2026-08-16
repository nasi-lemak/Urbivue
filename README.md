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

## Status

The project is in the planning stage. The documents above define the target architecture and
delivery order; Phase 0 (platform foundation) is the next implementation step.
