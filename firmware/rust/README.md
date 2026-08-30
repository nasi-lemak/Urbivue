# Urbivue Firmware — Rust Workspace

The **verified half of the firmware**, and the designated path for v2 devices.
Answering "can't we test before hardware?": yes — everything that is pure
computation is tested here, on the host, today. Only pin-reading and the radio
remain for the bench.

```
urbivue-core/       no_std, zero-dependency measurement logic — 38 unit tests
urbivue-emulator/   host binary running that exact logic against live MQTT
```

## urbivue-core — tested measurement logic

| Module | What it verifies |
|---|---|
| `median` | Outlier-rejecting median filter (splash, debris, waste bags) |
| `water` | Echo time → distance → level above datum, plausibility limits |
| `bins` | Distance → fill %, clamping, sensor blind-zone rejection |
| `rain` | Tips → mm/h, reed-switch debounce incl. millis() wraparound |
| `power` | True-RMS current from CT samples, mean-based bias removal (better than the C++ fixed-offset approach) |
| `tilt` | Gravity-vector normalization + angle vs stored baseline, any mounting orientation (Rodrigues-rotation test) |
| `traffic` | Burst→vehicle gap counter, tailgater handling |
| `pzem` | Modbus CRC-16 + frame validation — **found and fixed a real gap: the C++ sketch trusted uncrc'd frames** |
| `math` | no_std sqrt/acos verified against std to < 3e-4 rad |

Run: `cargo test` (host, stock toolchain — no embedded setup needed).

## urbivue-emulator — device-in-software

Synthesizes raw sensor signals (with injected outliers and noise), pushes them
through `urbivue-core`, and publishes over a hand-rolled ~100-line MQTT 3.1.1
client — the full device code path minus the pins:

```bash
cargo build --release
./target/release/urbivue-emulator bin EMU-BIN-001 22 500          # fills past the 90% rule
./target/release/urbivue-emulator water EMU-WL-001 10 1000        # rising river
./target/release/urbivue-emulator pump-current EMU-PMP-AMP 6 500  # idle -> 52 A
```

(Register the sensor first: `POST /api/sensors`. `MQTT_HOST`/`MQTT_PORT` env
vars point at the broker.)

Verified end-to-end in development: the bin profile's median filter rejected an
injected outlier on every cycle, the fill curve crossed 90 % and fired the real
`bins.fill_high` incident in the platform, and the RMS pipeline recovered a
simulated 52 A pump load to within 0.01 A.

## What is deliberately NOT here yet

The ESP32 binary crate (esp-hal/embassy for ESP32-C3). It needs the embedded
target + hardware on a bench to be honest engineering, and adding it now would
create a second unverifiable artifact. When hardware arrives: add
`urbivue-device-bin/` depending on `urbivue-core`, port one device
(recommended: the bin sensor — deep-sleep is where embassy shines), run it
side-by-side with the C++ unit, then decide about the fleet. The C++ sketches
in `firmware/*/` remain the current flash-and-go path; where their math is
shared with this crate, this crate is the tested reference.
