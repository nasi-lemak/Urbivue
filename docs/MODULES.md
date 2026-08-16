# Urbivue Module Specifications

Functional specs for the ten domain modules. Each module plugs into the platform services
described in [`ARCHITECTURE.md`](ARCHITECTURE.md): it defines asset types, inspection templates,
alert rules, citizen-report categories, scheduled jobs, and event handlers. Only behavior that
is genuinely domain-specific is listed here — inventory CRUD, map display, work orders, photos,
and dashboards come free from the platform.

---

## 1. Drain Management (`drainage`) — Phase 1

**Purpose:** know where every drain is, its condition, and keep it clear — especially before and
during the wet season.

- **Assets:** `drain_line` (open drains, pipes, culverts as lines), `drain_node` (inlets,
  manholes, outfalls as points). Lines reference upstream/downstream nodes → a lightweight
  network graph.
- **Inspections:** blockage/silt level (0–100 %), structural condition (cracks, collapse,
  erosion), cover state, photos. Condition score drives cleaning priority.
- **Schedules:** pre-monsoon cleaning campaign (all drains in priority order), recurring
  cleaning by zone; blockage ≥ 70 % auto-opens a work order.
- **Citizen reports:** blocked drain, broken/missing cover, bad smell, illegal discharge.
- **Domain logic:** *cleaning priority score* = f(blockage %, condition, upstream catchment
  size, flood-zone overlap, days since last cleaning). Simple upstream/downstream traversal:
  "this outfall is silted — list everything draining into it."
- **Events:** consumes `flood.incident.opened` → flags drains inside the flooded zone for
  post-event inspection.

## 2. Flood Monitoring (`flood`) — Phase 1

**Purpose:** real-time situational awareness of water levels and rainfall; early warning before
streets flood.

- **Assets:** `flood_zone` (risk polygons), monitoring stations (asset for the physical
  installation; sensors attach to it).
- **Sensors:** `water_level` (drain/river/retention pond), `rainfall` (rain gauges). Ingested
  via MQTT/HTTP into the telemetry pipeline.
- **Alert rules:** per-station level thresholds (advisory / warning / danger), rainfall
  intensity (mm/h) and cumulative (mm/24h) thresholds, rate-of-rise, sensor-silence during
  active rainfall (absence rule at `critical`).
- **Dashboard:** live map with station levels color-coded, zone status rollup (worst station in
  zone), 24 h sparklines, active-incident board for the duty officer; acknowledge/resolve flow.
- **Public:** read-only flood status map + advisory banner (feeds the public portal).
- **Events:** emits `flood.level.warning|danger` and `flood.incident.*` — consumed by pumps
  (auto-start checks), drainage (post-event inspection), slopes (rainfall correlation).
- **Phase 1 explicitly excludes** hydraulic modelling/forecasting — thresholds only; modelling
  is a possible later integration (SWMM/HEC-RAS import).

## 3. Water Pumps (`pumps`) — Phase 2

**Purpose:** keep flood/drainage pump stations healthy and know instantly when one fails.

- **Assets:** `pump_station` (parent) → `pump` (children).
- **Sensors:** run status, motor current (A), flow (L/s), sump level; derived series: run-hours,
  starts/day.
- **Alert rules:** pump failed to start when sump level > auto-start level (composite rule with
  flood data), overcurrent, excessive starts (hunting), station power loss, sump high-high.
- **Maintenance:** service schedules by run-hours (not calendar) — the schedule engine reads the
  run-hours series; spare-parts note fields on work orders.
- **Domain logic:** *readiness board* — before a forecast storm, one screen: every station,
  % pumps available, last test-run date. "Test run overdue" rule (no run detected in N days).
- **Events:** consumes `flood.level.warning` → verifies pumps in the affected zone are
  running/ready, raises incident if not.

## 4. Slope Monitoring (`slopes`) — Phase 2

**Purpose:** registry of engineered/natural slopes and early warning of movement (landslide risk).

- **Assets:** `slope` (polygon) with geotech attributes and a risk ranking.
- **Sensors:** `tilt` (inclinometers), `piezometer` (groundwater pressure), crack meters; plus
  nearby `rainfall` reuse from flood module.
- **Alert rules:** absolute tilt threshold, **rate-of-change** (Δtilt/24 h — the important one),
  piezometric pressure threshold, composite: sustained heavy rain over a high-risk slope raises
  a watch incident even without movement.
- **Inspections:** periodic geotech visual checklist (tension cracks, seepage, vegetation loss,
  drainage blockage on the slope); frequency scales with risk ranking.
- **Domain logic:** risk ranking (e.g. simplified slope-hazard scoring from angle, height,
  history, consequence of failure) → drives inspection frequency and alert sensitivity.
- **Citizen reports:** cracks, minor slips, debris on road.

## 5. Street Lighting (`lighting`) — Phase 3

**Purpose:** every pole inventoried; outages found by data, not by complaint.

- **Assets:** `light_pole` (point) with luminaire/circuit attributes; optional `circuit` grouping.
- **Sensors (where smart nodes exist):** on/off state, power draw, burn hours. **Without smart
  nodes:** outage detection falls back to citizen reports + night patrol inspections — the
  module must be fully useful with zero sensors.
- **Alert rules:** lamp drawing no power during scheduled on-hours (outage), day-burner
  (drawing power off-hours), circuit-level outage (N poles silent on one circuit → likely
  feeder fault, one incident not N).
- **Domain logic:** dusk–dawn schedule awareness (sunrise/sunset by city location); energy
  dashboard (kWh by circuit/ward, LED-conversion tracking).
- **Citizen reports:** light out, flickering, damaged pole, exposed wiring (auto-priority: high).

## 6. Waste Bins (`bins`) — Phase 3

**Purpose:** right-size collection: empty bins that are full, skip bins that aren't.

- **Assets:** `waste_bin` (point) with capacity/stream; `zone` reuse for collection routes.
- **Sensors:** ultrasonic `fill_level` (%) where fitted; unsensored bins carry an *estimated*
  fill from historical fill-rate (learned average per bin) — again useful with zero hardware.
- **Alert rules:** fill ≥ 90 % (collection due), fill ≥ 100 % + citizen overflow report
  (priority), no-collection-event in N days for a bin that should be on a route.
- **Domain logic:** *route generation job* — nightly, per stream: bins predicted ≥ threshold by
  tomorrow are grouped by zone into an ordered pickup list (nearest-neighbor heuristic first;
  proper VRP optimization is a later enhancement). Collection events logged (time, weight if
  available) → analytics on fill-rate seasonality.
- **Citizen reports:** overflowing bin, damaged bin, illegal dumping near bin, request new bin.

## 7. Traffic Counters (`traffic`) — Phase 3

**Purpose:** continuous traffic counts as a data product for planners.

- **Assets:** `traffic_counter` (point) with technology/lanes/direction attributes.
- **Sensors:** `vehicle_count` per interval (typically 5–15 min bins), optionally per class
  (car/truck/motorcycle/bicycle/pedestrian) as separate series.
- **Analytics (the core of this module):** AADT (annual average daily traffic) per station,
  hourly/weekday profiles, peak-hour factors, year-over-year trends, before/after comparison
  view for interventions ("did the new junction change volumes?").
- **Alert rules:** mostly device health — counter silent, counts flat-lined/implausible
  (stuck sensor). Optional: unusual congestion pattern (volume drop + adjacent rise).
- **Data product:** clean CSV/JSON export and a documented read-only API endpoint — planners
  and consultants are the users; export quality matters more than dashboards here.
- **No citizen reports; no work-order flows beyond device maintenance** — deliberately the
  thinnest module, mostly telemetry + analytics reuse.

## 8. Tree Management (`trees`) — Phase 4

**Purpose:** urban tree inventory with health and risk management (falling trees/branches are a
liability issue).

- **Assets:** `tree` (point) with species/dimensions/health/risk attributes.
- **Inspections:** arborist checklist — health rating, structural defects (cavities, deadwood,
  root damage, lean), pest/disease signs, photos; risk rating computed from defects ×
  target occupancy (over a road/playground vs. in a park interior).
- **Schedules:** risk-based inspection frequency (high-risk annually, low-risk 3–5 y);
  pruning cycles by species/ward; post-storm rapid assessment campaign (one tap: generate
  inspection work orders for all trees in affected zone with risk ≥ threshold).
- **Alert rules:** none sensor-based initially (tilt sensors on heritage trees is a possible
  later addition — the platform already supports it via the slopes-style tilt pipeline).
- **Domain logic:** species library (growth rate, known issues, native/invasive), canopy
  coverage stats per ward, planting-program tracking (target vs. planted vs. survived).
- **Citizen reports:** fallen tree/branch (auto-priority: emergency if blocking road),
  dangerous-looking tree, request planting, request pruning.

## 9. Public Toilets (`toilets`) — Phase 4

**Purpose:** clean, working, findable public toilets; measurable service quality.

- **Assets:** `toilet_facility` (point) with fixture counts, hours, operator/contractor.
- **Schedules:** cleaning rounds (multiple per day) — completed via quick mobile check-in
  (checklist + photo + timestamp) that stamps a `last_cleaned_at` the public can see;
  restocking checks (soap/paper) on the same checklist.
- **Sensors (optional):** visitor counter (footfall → cleaning frequency tuning), water/power
  meters (leak detection: night-time water flow ≠ 0 → alert).
- **Alert rules:** cleaning round missed (schedule breach → contractor SLA flag), leak
  detection as above.
- **Public portal:** find-nearest-toilet map with open-now filter, accessible-fixture flag,
  last-cleaned time, and a 1–5 rating + issue report form; ratings feed a per-facility and
  per-contractor quality score.
- **Citizen reports:** dirty, no water/supplies, broken fixture, locked during posted hours.

## 10. Accessible Facilities (`accessibility`) — Phase 4

**Purpose:** inventory and audit of accessibility infrastructure; a public accessibility map.

- **Assets:** `accessible_feature` — ramps, tactile guide paths, accessible parking bays,
  lifts, audio signals at crossings, accessible toilets (cross-links to the toilets module's
  facility rather than duplicating it).
- **Inspections:** compliance audit templates per feature kind against the applicable standard
  (e.g. ramp slope %, width, handrails, tactile-tile condition); result = `compliant` /
  `minor_issues` / `non_compliant`, driving a remediation work-order backlog.
- **Domain logic:** ward-level accessibility coverage score (features present vs. a checklist
  of expected feature kinds per public building/junction); remediation backlog dashboard
  sorted by severity and footfall.
- **Public portal:** accessibility layer on the public map — where are compliant ramps,
  accessible parking, accessible toilets (with the toilets module's live status).
- **Citizen reports:** blocked ramp (parked vehicles — priority), damaged tactile paving,
  broken lift, request new feature. Reporters here are often the affected users; response-time
  SLA is tracked prominently.
- **No sensors** — this module proves the platform works for pure inventory + audit + citizen
  engagement domains.

---

## Cross-module interactions (event bus)

| Producer event | Consumers | Effect |
|---|---|---|
| `flood.level.warning/danger` | pumps | readiness check on stations in zone; incident if pump not running |
| `flood.incident.opened` | drainage, slopes | flag drains in zone for inspection; raise slope watch if rain sustained |
| `rainfall.heavy` (flood) | slopes, drainage | slope watch incidents; pre-emptive drain-crew notice |
| `pumps.station.offline` | flood | escalate zone status (capacity lost) |
| `report.created` (any) | owning module | spatial dedup, asset match, triage queue |
| `storm.aftermath` (manual trigger) | trees, lighting, drainage | generate rapid-assessment campaigns |
