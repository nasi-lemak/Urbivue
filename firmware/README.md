# Urbivue Prototype Firmware

Reference firmware for ESP32-based prototype sensor devices. Each sketch publishes
readings in the platform's MQTT ingest contract (`urbivue/ingest/<sensorId>`,
payload `{"value": <number>}`) using the shared plumbing in
[`common/urbivue_device.h`](common/urbivue_device.h).

| Sketch | Device | Sensor kind(s) | Cadence | Power |
|---|---|---|---|---|
| `water-level/` | River/drain level station | `water_level` | 60 s | Mains or solar |
| `rain-gauge/` | Tipping-bucket rain gauge | `rainfall` | 60 s | Mains or solar |
| `pump-monitor/` | Pump station monitor | `run_status`, `current` | 30 s | Panel supply |
| `slope-monitor/` | Slope tilt (SCL3300) + temp (+ piezometer) | `tilt`, `temperature`, `piezometer` | 10 min, deep sleep | Battery + solar |
| `bin-fill/` | Bin fill level | `fill_level` | 30 min, deep sleep | Battery |
| `lighting-node/` | Luminaire power monitor | `power_draw` | 5 min | Pole supply |
| `traffic-counter/` | Single-lane counter | `vehicle_count` | 5 min bins | Mains or solar |

## Building & flashing

1. Arduino IDE (or `arduino-cli`) with the **ESP32 board package** and the
   **PubSubClient** library installed.
2. Pick the board: classic **ESP32 DevKit (WROOM-32/32D/32E)** works for every
   sketch; for the battery-powered nodes (`bin-fill/`, `slope-monitor/`) an
   **ESP32-C3** is preferred — the **Seeed XIAO ESP32C3** (onboard Li-ion
   charger, lean deep-sleep draw) or a C3 Super Mini. Those two sketches select
   their pins automatically from the compile target (select "XIAO_ESP32C3" or
   "ESP32C3 Dev Module" in the IDE); avoid WROOM-**32U** modules (no onboard
   antenna). Exact parts and wiring: [`docs/HARDWARE.md`](../docs/HARDWARE.md)
   §3 and §5.
3. Open a sketch, fill in the `CFG` block (Wi-Fi, broker host, device name) and the
   `SENSOR_ID` you registered in Urbivue (see the provisioning workflow in
   [`docs/HARDWARE.md`](../docs/HARDWARE.md)).
4. Set device-specific constants marked "measure on installation" (mount height,
   bin depth, CT calibration).
5. Flash over USB; watch the serial monitor for the first publish, then confirm
   the reading in Urbivue (`GET /api/sensors` shows last value + last seen).

## Status & scope

This is **prototype/pilot-grade** reference firmware: it compiles against the
standard ESP32 Arduino core but has not been exercised on physical hardware in
this repository's CI — bench-test each build before field mounting. Known
prototype limitations, addressed in docs/HARDWARE.md §2 for production:

- Wi-Fi + unauthenticated MQTT (fine on a private ops network; not on open
  networks — enable Mosquitto auth and per-device credentials for the street).
- No OTA updates; reflash over USB.
- Timestamps are server-side (assigned on ingest) — deep-sleeping devices that
  buffer readings would need RTC + payload `ts`, which the ingest contract
  already accepts.

The SCL3300 SPI frame logic lives in a hardware-free header
([`common/scl3300_frames.h`](common/scl3300_frames.h)) with a host test run in
CI (`test_scl3300_frames.cpp`), mirrored in the Rust core — both reproduce the
datasheet's command words exactly.

The platform's simulator (`packages/simulator`) speaks the exact same contract,
so everything downstream of the radio can be developed without any hardware.
