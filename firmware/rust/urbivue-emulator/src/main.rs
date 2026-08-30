//! Urbivue device emulator: exercises the *exact* measurement code the
//! firmware will run (urbivue-core), publishing through the real MQTT
//! ingest contract. Only the pin-reading layer is faked — raw sensor
//! signals are synthesized, then filtered/converted by the shared logic.
//!
//! Usage:
//!   urbivue-emulator <profile> <sensorId> [readings] [intervalMs]
//!   profiles: bin | water | pump-current
//!   env: MQTT_HOST (localhost), MQTT_PORT (1883)

mod mqtt;

use std::f32::consts::TAU;

use urbivue_core::{bins, median, power, water};

fn pseudo_noise(seed: &mut u32) -> f32 {
    // xorshift; deterministic runs make failures reproducible.
    *seed ^= *seed << 13;
    *seed ^= *seed >> 17;
    *seed ^= *seed << 5;
    (*seed as f32 / u32::MAX as f32) - 0.5
}

/// Synthesize raw echo distances and reduce them the way the firmware does:
/// median-of-7 with injected outliers, then domain conversion.
fn bin_reading(step: usize, seed: &mut u32) -> Option<f32> {
    const BIN_DEPTH_M: f32 = 0.95;
    let true_distance = (0.9 - step as f32 * 0.04).max(0.06); // filling up
    let mut pings = [0f32; 7];
    for (i, ping) in pings.iter_mut().enumerate() {
        *ping = true_distance + pseudo_noise(seed) * 0.01;
        if i == 2 {
            *ping = 0.03; // a bag near the sensor: classic outlier
        }
    }
    let distance = median::median_in_place(&mut pings, 3)?;
    bins::fill_pct(BIN_DEPTH_M, distance)
}

fn water_reading(step: usize, seed: &mut u32) -> Option<f32> {
    const MOUNT_HEIGHT_M: f32 = 4.5;
    let true_level = 0.4 + step as f32 * 0.02;
    let mut pings = [0f32; 7];
    for ping in pings.iter_mut() {
        let distance = MOUNT_HEIGHT_M - true_level + pseudo_noise(seed) * 0.02;
        *ping = distance;
    }
    let distance = median::median_in_place(&mut pings, 3)?;
    water::level_m(MOUNT_HEIGHT_M, distance)
}

fn pump_current_reading(step: usize, seed: &mut u32) -> Option<f32> {
    // Idle for the first few readings, then running at ~52 A.
    let amplitude_mv = if step < 3 { 4.0 } else { 52.0 / 30.0 * 1000.0 * 1.414 };
    let samples: Vec<f32> = (0..400)
        .map(|i| {
            let t = i as f32 / 400.0 * 10.0 * TAU;
            1650.0 + amplitude_mv * t.sin() + pseudo_noise(seed) * 3.0
        })
        .collect();
    power::rms_amps(&samples, 30.0)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: urbivue-emulator <bin|water|pump-current> <sensorId> [readings] [intervalMs]");
        std::process::exit(2);
    }
    let profile = args[1].as_str();
    let sensor_id = args[2].as_str();
    let readings: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(5);
    let interval_ms: u64 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(1000);

    let host = std::env::var("MQTT_HOST").unwrap_or_else(|_| "localhost".into());
    let port: u16 = std::env::var("MQTT_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(1883);

    let mut client = mqtt::MqttClient::connect(&host, port, &format!("emu-{sensor_id}"))
        .unwrap_or_else(|e| {
            eprintln!("MQTT connect failed: {e}");
            std::process::exit(1);
        });
    println!("emulator '{profile}' -> urbivue/ingest/{sensor_id} ({readings} readings)");

    let mut seed = 0x1234_5678u32;
    for step in 0..readings {
        let value = match profile {
            "bin" => bin_reading(step, &mut seed),
            "water" => water_reading(step, &mut seed),
            "pump-current" => pump_current_reading(step, &mut seed),
            other => {
                eprintln!("unknown profile '{other}'");
                std::process::exit(2);
            }
        };
        match value {
            Some(v) => {
                let topic = format!("urbivue/ingest/{sensor_id}");
                let payload = format!("{{\"value\":{v:.3}}}");
                client.publish(&topic, payload.as_bytes()).unwrap_or_else(|e| {
                    eprintln!("publish failed: {e}");
                    std::process::exit(1);
                });
                println!("[{step}] {payload}");
            }
            None => println!("[{step}] reading rejected by validation (as designed)"),
        }
        if step + 1 < readings {
            std::thread::sleep(std::time::Duration::from_millis(interval_ms));
        }
    }
    client.disconnect();
    println!("done");
}
