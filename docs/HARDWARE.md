# Urbivue Sensor Hardware Guide

Prototype device designs, bills of materials, installation procedure, and the
provisioning workflow that connects a physical device to the platform. Reference
firmware for every device lives in [`firmware/`](../firmware/).

Everything here is **vendor-neutral by design**: the platform only requires that
readings arrive on `urbivue/ingest/<sensorId>` (MQTT) or `POST /api/ingest`
(HTTP, `X-Ingest-Key`). The prototypes below are the cheapest credible way to
get real data flowing; §6 lists production-grade commercial equivalents.

## 1. The common prototype platform

Every prototype shares a core (≈ USD 15 before the sensing element):

| Part | Purpose | ~USD |
|---|---|---|
| ESP32 DevKit (WROOM-32) | MCU + Wi-Fi | 5 |
| IP65/IP67 ABS enclosure + cable glands | Weatherproofing | 6 |
| Buck converter (12/24 V → 5 V) or 18650 + solar charge board | Power | 4 |
| Mounting hardware, wire, heat-shrink | Installation | 2 |

Firmware contract (all sketches): connect Wi-Fi → connect MQTT → publish
`{"value": x}` on the sensor's topic at the device's cadence. The platform does
the rest — storage, rules, incidents, dashboards.

## 2. Network architecture

```
Prototype/pilot:   device --Wi-Fi--> Mosquitto (urbivue stack) --> API ingest
Production:        device --LoRaWAN/NB-IoT--> gateway/vendor cloud --webhook--> POST /api/ingest
Vendor platforms:  smart-lighting / bin / traffic vendor cloud --webhook--> POST /api/ingest
```

- Wi-Fi prototypes assume coverage from a nearby facility (pump house, depot) or
  a 4G router in the enclosure. Fine for pilots; not city-scale.
- For street-scale deployments use LoRaWAN (great for bins, gauges, tilt — low
  data, battery friendly) or NB-IoT (better for pump/lighting nodes needing
  minute-cadence). The gateway or network server forwards decoded uplinks to
  `POST /api/ingest` with the ingest key — one small adapter per vendor payload.
- **Production networking is authenticated**: registering a device
  (`POST /api/sensors`) returns a one-time device key. The device connects to
  the production broker with username = its sensor id and password = that key,
  and the broker's ACL only lets it publish its own topic; over HTTP the same
  key goes in `X-Device-Key`. Keys can be rotated or revoked per device. The
  dev broker (`mosquitto.conf`) stays anonymous for bench work only.

## 3. Device designs

### 3.1 Water-level station — `firmware/water-level`
- **Sensing:** JSN-SR04T waterproof ultrasonic (~USD 8), face-down over water on
  a bridge rail or gantry arm. Range ~0.25–6 m. For >6 m or wave-prone sites use
  a radar sensor (~USD 90+) or 4–20 mA pressure probe in a stilling well.
- **Install:** rigid mount (readings are relative to the transducer face);
  measure transducer-to-datum height on install day → `MOUNT_HEIGHT_M`.
  Median-of-7 sampling in firmware rejects splash/debris.
- **Calibrate:** compare against a staff gauge at commissioning and after storms.
- **BOM beyond core:** JSN-SR04T $8, level divider $1. **Total ≈ USD 24.**

### 3.2 Rain gauge — `firmware/rain-gauge`
- **Sensing:** tipping-bucket gauge with reed-switch output (Misol WH-SP-RG
  ~USD 12, or a Davis/professional bucket for accuracy). `MM_PER_TIP` from the
  bucket datasheet (typ. 0.2794 mm).
- **Install:** dead level, open sky, ≥ 2× obstacle-height away from walls/trees;
  clean the funnel on the monthly round.
- **BOM beyond core:** gauge $12. **Total ≈ USD 27.**

### 3.3 Pump monitor — `firmware/pump-monitor`
- **Sensing:** run status from a spare voltage-free auxiliary contact on the
  pump contactor (isolated — never mains into the MCU); current via SCT-013-000
  clip-on CT (~USD 6) + 33 Ω burden into the ADC.
- **Install:** by an electrician, inside the starter panel; ESP32 powered from
  the panel's 24 V control supply via buck. Calibrate `CT_A_PER_V` against a
  clamp meter at commissioning; sump level = one water-level station (§3.1) in
  the wet well (`sump_level` kind).
- **BOM beyond core:** CT $6, resistors $1. **Total ≈ USD 22 per pump.**

### 3.4 Slope monitor — `firmware/slope-monitor`
- **Sensing:** MPU-6050 accelerometer (~USD 3) potted in epoxy, box anchored to
  the slope face or a grouted rod; optional 4–20 mA piezometer transducer
  (~USD 60–150) in a standpipe via ADS1115 ADC (~USD 4).
- **Install:** capture the zero baseline at commissioning (hold BOOT 5 s); the
  platform's rate-of-change rule then watches Δtilt, so absolute accuracy
  matters less than stability. Solar + 18650; deep-sleeps 10 min.
- **Honest limit:** a $3 MEMS chip detects gross movement (0.1–0.2° resolution),
  not the millimeter creep a geotechnical inclinometer sees. Treat it as an
  early-warning tripwire on already-ranked slopes; instrument-grade sensors
  drop into the same `tilt`/`piezometer` pipeline unchanged.
- **BOM beyond core:** MPU-6050 $3, solar+battery $12 (+piezo option $65+).
  **Total ≈ USD 30 (tilt-only).**

### 3.5 Bin fill sensor — `firmware/bin-fill`
- **Sensing:** HC-SR04P ultrasonic (~USD 2) inside the lid, pointing down.
  Measure empty-bin depth → `BIN_DEPTH_M`.
- **Install:** drill + gland through the lid, sensor face flush; 18650 cell,
  30-min deep-sleep cadence runs months. Expect abuse: zip-tie strain relief,
  glue everything.
- **BOM beyond core:** sensor $2, battery holder $3. **Total ≈ USD 20/bin** —
  which is why the platform also supports unsensored bins on fixed routes;
  sensor only the high-variance locations.

### 3.6 Lighting node — `firmware/lighting-node`
- **Sensing:** PZEM-004T v3 energy monitor (~USD 9) on the luminaire feed
  inside the pole access door — measures real power, isolated from the MCU.
- **Install:** electrician; node powers from the same feed (note: dies with a
  dead feed — which the platform reads correctly as an outage via staleness +
  zero draw on the circuit).
- **Reality check:** at scale you buy NEMA-socket smart nodes (USD 40–80/pole,
  install in minutes) and webhook their vendor platform into `/api/ingest`;
  this prototype is for validating the outage/day-burner/circuit logic on a
  handful of poles first.
- **BOM beyond core:** PZEM $9. **Total ≈ USD 24/pole.**

### 3.7 Traffic counter — `firmware/traffic-counter`
- **Sensing:** HB100/RCWL-0516 doppler module (~USD 3–10) aimed across one
  lane, or an IR break-beam pair. Counts detection bursts separated by ≥ 0.8 s;
  publishes 5-minute bins.
- **Honest limit:** ±10–15 % on free-flowing single-lane traffic, no
  classification, degrades in congestion. Good for trend/pilot data; use
  commercial radar (USD 1–3k) or loops for survey-grade counts — same
  `vehicle_count` pipeline.
- **BOM beyond core:** radar module $6. **Total ≈ USD 21.**

## 4. Provisioning workflow (any device)

1. **Register the sensor** (admin, once per device):
   ```bash
   curl -X POST https://<host>/api/sensors \
     -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
     -d '{"externalId":"WL-010","kind":"water_level","unit":"m","assetCode":"MS-003"}'
   # → returns the device's MQTT topic: urbivue/ingest/WL-010
   ```
   Attach to an existing asset by `assetCode`, or pass `location` for a
   standalone sensor. Create the asset first if it's a new site
   (`POST /api/assets`, e.g. a new `monitoring_station`).
2. **Configure the firmware**: set `SENSOR_ID` to the `externalId`, fill in
   network config and installation constants, flash.
3. **Bench test**: power the device next to the broker; confirm
   `GET /api/sensors` shows a fresh `lastSeenAt` and a sane value.
4. **Install & calibrate** per the device section above; record installation
   constants (mount height, baseline) in the sensor's `config` for the audit
   trail.
5. **Verify the safety net**: unplug the device — the matching absence rule
   should open a silence incident within its window; power it back and watch
   the incident self-heal. Now the platform is watching the watcher.

## 5. Pilot shopping list (the recommended starting point)

The flood/pump/slope interlock chain, live with real data, for about **USD 250**
in parts plus one electrician visit:

| Qty | Device | Purpose |
|---|---|---|
| 2 | Water-level station | The two river stations (WL-001/002) |
| 1 | Rain gauge | Rainfall rules + slope watch trigger |
| 1 | Pump monitor + sump level | Readiness board + flood interlock |
| 1 | Slope monitor (tilt-only) | Movement tripwire on the top-ranked slope |

Lighting/bins/traffic prototypes are optional add-ons; their modules also run
sensor-free on inspections and citizen reports.

## 6. Production-grade equivalents (drop-in, same pipeline)

| Prototype | Production replacement |
|---|---|
| JSN-SR04T level station | Radar level sensor (VEGA, OTT) via 4–20 mA/SDI-12 datalogger or LoRaWAN node |
| Misol rain gauge | Davis / Lambrecht tipping bucket on the same pulse interface |
| SCT-013 pump CT | Panel power meter with Modbus → small gateway adapter |
| MPU-6050 tilt | In-place inclinometer chain + vibrating-wire piezometers on a geotech logger |
| PZEM lighting node | NEMA-socket smart luminaire controllers (vendor webhook → `/api/ingest`) |
| HC-SR04P bin sensor | Commercial LoRaWAN bin sensors (Sensoneo-class) |
| HB100 counter | Side-fire radar (Wavetronix-class) or inductive loops |
