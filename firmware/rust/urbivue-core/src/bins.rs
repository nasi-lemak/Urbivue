//! Bin fill sensor: lid-to-surface distance -> fill percentage.

/// Fill percentage from the measured distance and the empty-bin depth
/// (lid sensor face to bin floor). Clamped to 0..=100; None when the
/// distance is implausible or the bin depth is unconfigured.
pub fn fill_pct(bin_depth_m: f32, distance_m: f32) -> Option<f32> {
    if bin_depth_m <= 0.0 || !(0.02..=4.0).contains(&distance_m) {
        return None;
    }
    Some(((1.0 - distance_m / bin_depth_m) * 100.0).clamp(0.0, 100.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_bin_reads_zero() {
        assert!((fill_pct(0.95, 0.95).unwrap() - 0.0).abs() < 1e-4);
    }

    #[test]
    fn half_full() {
        assert!((fill_pct(1.0, 0.5).unwrap() - 50.0).abs() < 1e-4);
    }

    #[test]
    fn nearly_full_at_sensor_near_limit() {
        // Waste 3 cm below the lid: (1 - 0.03/0.95) * 100 ≈ 96.8 %.
        assert!((fill_pct(0.95, 0.03).unwrap() - 96.842).abs() < 0.01);
    }

    #[test]
    fn deeper_than_bin_clamps_to_zero() {
        // Echo from the ground through an open/damaged bin bottom.
        assert_eq!(fill_pct(0.95, 1.2).unwrap(), 0.0);
    }

    #[test]
    fn bad_input_rejected() {
        assert_eq!(fill_pct(0.0, 0.5), None);
        assert_eq!(fill_pct(0.95, 0.005), None);
    }
}
