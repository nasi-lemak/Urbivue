# Urbivue Sensor Hardware Guide

Prototype device designs, bills of materials, installation procedure, and the
provisioning workflow that connects a physical device to the platform. Reference
firmware for every device lives in [`firmware/`](../firmware/).

Everything here is **vendor-neutral by design**: the platform only requires that
readings arrive on `urbivue/ingest/<sensorId>` (MQTT) or `POST /api/ingest`
(HTTP, `X-Ingest-Key`). The prototypes below are the cheapest credible way to
get real data flowing — with quality parts where safety or outdoor survival
depends on it (slope sensor, rain gauge, enclosures, power). §5 is the exact
pilot parts list; §6 lists production-grade commercial equivalents.

## 1. The common prototype platform

Every prototype shares a core (≈ USD 15 before the sensing element):

| Part | Purpose | ~USD |
|---|---|---|
| ESP32 DevKit (WROOM-32E) + screw-terminal breakout board | MCU + Wi-Fi, field-serviceable wiring | 4 |
| IP67 **polycarbonate** enclosure + nylon cable glands | Weatherproofing (ABS cracks in tropical sun) | 6 |
| Mean Well 5 V DIN-rail supply, or 18650 + solar charger | Power | 4–10 |
| 304 stainless fixings, conformal coating, desiccant, glue-lined heat-shrink | Surviving heat + humidity | 3 |

Board notes: any WROOM-32/32D/32E DevKit works (avoid **32U** — no onboard
antenna); buy headers pre-soldered and pair with a screw-terminal breakout.
For the **battery-powered nodes** (bin fill, slope monitor) use an
**ESP32-C3** instead — the **Seeed XIAO ESP32C3** is recommended (onboard
Li-ion charger, lean deep-sleep draw, external antenna; ~USD 5), a C3 Super
Mini also works. Both sketches select pins from the compile target; the XIAO
silkscreen shows D-numbers, which the sketches note next to each GPIO.

Build rules for anything outdoors: no loose Dupont jumper wires — screw
terminals or solder only; spray boards with conformal coating; a desiccant
pack in every box.

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
- **Part:** JSN-SR04T-2.0 (sealed transducer on a cable — not a bare HC-SR04
  relisted as "waterproof").
- **BOM beyond core:** JSN-SR04T $5, level divider $1. **Total ≈ USD 20.**

### 3.2 Rain gauge — `firmware/rain-gauge`
- **Sensing:** tipping-bucket gauge with pulse (reed-switch) output.
  Recommended: a **professional stainless-steel 0.2 mm/tip gauge** (~USD
  45–110) — rainfall triggers the slope watch, so it feeds a safety decision,
  and stainless survives years of sun. Budget option: Misol WH-SP-RG (~USD 12,
  plastic, 0.2794 mm/tip; buy the gauge alone, not the weather-station set).
  Set `MM_PER_TIP` to the bucket's value (firmware default 0.2).
- **Wiring:** two wires to GPIO27 + GND, polarity irrelevant. The Misol's RJ11
  plug uses the middle two pins — an RJ11 breakout keeps the cable intact.
  Check with a multimeter: one short beep per tip.
- **Install:** dead level, open sky, ≥ 2× obstacle-height away from walls/trees;
  clean the funnel on the monthly round.
- **BOM beyond core:** gauge $45–110 (pro) or $12 (Misol).

### 3.3 Pump monitor — `firmware/pump-monitor`
- **Sensing:** run status from a spare voltage-free auxiliary contact on the
  pump contactor (isolated — never mains into the MCU); current via a YHDC
  **SCT-013-000** clip-on CT (~USD 5; the **-000** suffix is the 100 A : 50 mA
  current-output version the 33 Ω burden is designed for — the -030/-050
  voltage-output variants would silently break calibration) + 33 Ω burden into
  the ADC.
- **Install:** by an electrician, inside the starter panel; ESP32 powered from
  the panel's 24 V control supply via buck. Calibrate `CT_A_PER_V` against a
  clamp meter at commissioning; sump level = one water-level station (§3.1) in
  the wet well (`sump_level` kind).
- **BOM beyond core:** CT $6, resistors $1. **Total ≈ USD 22 per pump.**

### 3.4 Slope monitor — `firmware/slope-monitor`
- **Why the sensor matters here:** the critical rule fires on **0.5° of tilt
  change in 24 h**. A general-purpose MEMS accelerometer like the MPU-6050
  drifts by roughly that much across a day-night temperature swing in a
  sun-heated box — enough for false critical alarms, or to force thresholds
  so wide they miss real movement. So the field sensor is a purpose-built
  inclinometer; the MPU-6050 remains supported for bench work only
  (`TILT_SENSOR_SCL3300 0`).
- **Sensing:** **Murata SCL3300** inclinometer module (~USD 15–35) on SPI,
  read in its low-noise inclination mode. Every SPI frame is CRC-,
  status- and address-checked before use (host-tested in C++ and Rust against
  the datasheet command words); if the sensor fails its identity check, no
  tilt is published and the `slopes.sensor_silent` rule flags the dead
  monitor within 45 min. Enclosure temperature is published alongside tilt
  (`<id>-TEMP`, kind `temperature`) so residual thermal drift is visible on
  the chart. Optional 4–20 mA piezometer (~USD 60–150) in a standpipe via
  ADS1115 (I2C).
- **Wiring (3.3 V only):**

  | SCL3300 | ESP32-C3 / XIAO | Classic ESP32 |
  |---|---|---|
  | VCC | 3V3 | 3V3 |
  | GND | GND | GND |
  | SCK | GPIO4 (D2) | GPIO18 |
  | MISO / SDO | GPIO5 (D3) | GPIO19 |
  | MOSI / SDI | GPIO10 (D10) | GPIO23 |
  | CS | GPIO3 (D1) | GPIO5 |

  ADS1115 (if fitted) on I2C: GPIO6/7 (D4/D5) on C3, GPIO21/22 on classic.
- **Install:** anchor the box to a grouted rod, not surface soil — a moving
  bracket defeats any sensor — and shade it. Capture the zero baseline at
  commissioning (hold BOOT 5 s); recapture after any sensor or mounting
  change. Register both `TLT-xxx` (tilt, deg) and `TLT-xxx-TEMP`
  (temperature, °C). Solar + 18650 via CN3791 MPPT charger; the sensor is
  powered down and the MCU deep-sleeps between 10-minute readings.
- **Honest limit:** still an early-warning instrument, not a geotechnical
  survey — it sees tilt of the box's anchor, not creep at depth. On slopes
  that threaten homes, add borehole inclinometers and piezometers (§6); they
  feed the same `tilt`/`piezometer` pipeline unchanged.
- **BOM beyond core:** SCL3300 $15–35, solar panel + MPPT charger + cell $15
  (+piezo option $65+). **Total ≈ USD 45–65 (tilt-only).**

### 3.5 Bin fill sensor — `firmware/bin-fill`
- **Sensing:** HC-SR04P ultrasonic (~USD 2) inside the lid, pointing down.
  Measure empty-bin depth → `BIN_DEPTH_M`.
- **Install:** drill + gland through the lid, sensor face flush; 18650 cell,
  30-min deep-sleep cadence runs months (XIAO ESP32C3 recommended, cell on
  its BAT pads — see §1). The sensor must be the 3.3 V-capable **HC-SR04P**,
  not the 5 V-only HC-SR04.
  Expect abuse: zip-tie strain relief, glue everything.
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

## 5. Pilot parts list (exact items)

The flood/pump/slope interlock chain, live with real data: 2 river
water-level stations, a rain gauge, a pump monitor + sump level, and one slope
monitor, plus one electrician visit. Search terms are for Taobao / Pinduoduo /
1688; buy from flagship (旗舰店) or well-reviewed stores and take the spares.

**Boards**

| Qty | Item | Search | ~¥ each |
|---|---|---|---|
| 5 + 1 spare | ESP32 DevKit, WROOM-32E, CP2102, 38-pin, USB-C, headers pre-soldered | `ESP32 WROOM-32E CP2102 38针 Type-C 已焊` | 12–18 |
| 5 | Screw-terminal breakout board for the above | `ESP32扩展板 螺丝端子 38P` | 8–12 |
| 1 + 1 spare | Seeed XIAO ESP32C3 (slope monitor) | `XIAO ESP32C3 矽递` | 35–45 |

**Sensors**

| Qty | Item | Search | ~¥ each |
|---|---|---|---|
| 3 + 1 spare | JSN-SR04T-2.0 waterproof ultrasonic (river ×2, sump ×1) | `JSN-SR04T-2.0 一体化防水` | 30–40 |
| 1 | Professional stainless tipping-bucket rain gauge, 0.2 mm, pulse output | `翻斗式雨量计 0.2mm 不锈钢 脉冲输出` | 300–800 |
| 1 | YHDC SCT-013-000 split-core CT, 100 A : 50 mA | `YHDC SCT-013-000 100A/50mA` | 30–40 |
| 1 + 1 spare | Murata SCL3300 inclinometer module | `SCL3300 倾角模块` | 100–250 |
| 1 | MPU-6050 (GY-521), bench testing only | `GY-521 MPU6050` | 5 |
| 1 | Resistor kit incl. 33 Ω (CT burden) | `金属膜电阻包 1/4W` | 10 |

**Enclosures and build**

| Item | Search |
|---|---|
| IP67 polycarbonate boxes with gasket (not ABS) | `PC防水盒 IP67` |
| Nylon cable glands PG7/PG9 | `尼龙防水接头 PG7` |
| 304 stainless screws, pipe clamps, L-brackets | `304不锈钢 螺丝 / 抱箍` |
| Conformal coating spray | `三防漆 喷雾` |
| Silica gel desiccant packs | `硅胶干燥剂 小包` |
| Glue-lined heat-shrink kit | `带胶热缩管 套装` |
| Outdoor UV-resistant sensor cable | `户外 耐候 护套线` |

**Power**

| Where | Item | Search |
|---|---|---|
| Mains-powered stations | Mean Well HDR-15-5 DIN-rail 5 V supply (official store) | `明纬 HDR-15-5` |
| Slope monitor | 6 V 2 W monocrystalline panel + CN3791 MPPT charger | `单晶太阳能板 6V 2W`, `CN3791 MPPT` |
| Slope monitor | 18650 cell: Panasonic NCR18650B / Samsung 35E / LG MJ1 | **not from marketplaces** — buy brand cells from a reputable local shop; "5000–9900 mAh" listings are fake |

**Tools (one-time):** T12 soldering station (`T12 焊台`), UNI-T multimeter
(`优利德 万用表`), a small bubble level for the rain gauge.

**Budget:** ≈ ¥1,800–2,500 (USD 250–350) including tools. The largest optional
savings: the Misol gauge instead of the stainless one (–¥300–700), and cheap
buck modules instead of Mean Well supplies (–¥200).

Optional add-ons (modules also run sensor-free on inspections and citizen
reports): bin fill — XIAO ESP32C3 + HC-SR04P (`HC-SR04P 3.3V`); lighting node —
PZEM-004T-100A **V3.0**; traffic counter — RCWL-0516 or HB100.

## 6. Production-grade equivalents (drop-in, same pipeline)

| Prototype | Production replacement |
|---|---|
| JSN-SR04T level station | Radar level sensor (VEGA, OTT) via 4–20 mA/SDI-12 datalogger or LoRaWAN node |
| Stainless tipping bucket | WMO-grade gauge (Lambrecht, OTT) on the same pulse interface |
| SCT-013 pump CT | Panel power meter with Modbus → small gateway adapter |
| SCL3300 tilt | In-place inclinometer chain + vibrating-wire piezometers on a geotech logger |
| PZEM lighting node | NEMA-socket smart luminaire controllers (vendor webhook → `/api/ingest`) |
| HC-SR04P bin sensor | Commercial LoRaWAN bin sensors (Sensoneo-class) |
| HB100 counter | Side-fire radar (Wavetronix-class) or inductive loops |
