//! Pump current: true-RMS from CT burden-voltage samples.
//!
//! Improvement over the C++ sketch: the DC bias is estimated from the
//! sample mean instead of assuming a fixed 1.65 V midpoint, so divider
//! tolerance and ADC offset drop out of the measurement.

use crate::math::sqrt;

/// RMS current (A) from ADC samples in millivolts. `amps_per_volt` is the
/// CT calibration (SCT-013-000 with 33R burden ~= 30 A/V). None with too
/// few samples for a meaningful RMS (< 2 mains cycles at any sane rate).
pub fn rms_amps(samples_mv: &[f32], amps_per_volt: f32) -> Option<f32> {
    if samples_mv.len() < 40 || amps_per_volt <= 0.0 {
        return None;
    }
    let n = samples_mv.len() as f32;
    let mean_mv = samples_mv.iter().sum::<f32>() / n;
    let sum_sq: f32 = samples_mv
        .iter()
        .map(|s| {
            let centred = (s - mean_mv) / 1000.0; // -> volts
            centred * centred
        })
        .sum();
    Some(sqrt(sum_sq / n) * amps_per_volt)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine_samples(amplitude_mv: f32, offset_mv: f32, n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| {
                let t = i as f32 / n as f32 * 10.0 * core::f32::consts::TAU; // 10 cycles
                offset_mv + amplitude_mv * t.sin()
            })
            .collect()
    }

    #[test]
    fn pure_sine_rms_is_amplitude_over_sqrt2() {
        // 1 V peak on the CT with 30 A/V => 21.21 A RMS.
        let samples = sine_samples(1000.0, 1650.0, 400);
        let amps = rms_amps(&samples, 30.0).unwrap();
        assert!((amps - 21.213).abs() < 0.1, "got {amps}");
    }

    #[test]
    fn dc_offset_does_not_leak_into_reading() {
        // Same signal, badly skewed bias: reading must not change.
        let a = rms_amps(&sine_samples(1000.0, 1650.0, 400), 30.0).unwrap();
        let b = rms_amps(&sine_samples(1000.0, 1300.0, 400), 30.0).unwrap();
        assert!((a - b).abs() < 0.05);
    }

    #[test]
    fn idle_pump_reads_near_zero() {
        let samples = vec![1650.0f32; 400];
        assert!(rms_amps(&samples, 30.0).unwrap() < 0.01);
    }

    #[test]
    fn too_few_samples_rejected() {
        assert_eq!(rms_amps(&[1650.0; 10], 30.0), None);
    }
}
