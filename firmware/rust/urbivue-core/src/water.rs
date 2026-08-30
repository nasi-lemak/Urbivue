//! Water-level station: ultrasonic distance -> level above datum.

/// Convert echo round-trip time to one-way distance in metres
/// (speed of sound ~343 m/s at 20°C).
pub fn distance_m_from_echo_us(echo_us: u32) -> f32 {
    (echo_us as f32) * 0.000_343 / 2.0
}

/// Level above the gauge datum. `mount_height_m` is transducer face to
/// datum, measured at installation. Clamped at zero (mud/debris can read
/// "below datum"); None for implausible distances (bad echo).
pub fn level_m(mount_height_m: f32, distance_m: f32) -> Option<f32> {
    if !(0.05..=8.0).contains(&distance_m) || mount_height_m <= 0.0 {
        return None;
    }
    Some((mount_height_m - distance_m).max(0.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn echo_time_to_distance() {
        // ~5.83 ms round trip == 1 m away.
        assert!((distance_m_from_echo_us(5831) - 1.0).abs() < 0.01);
    }

    #[test]
    fn level_is_mount_height_minus_distance() {
        assert!((level_m(4.5, 3.2).unwrap() - 1.3).abs() < 1e-6);
    }

    #[test]
    fn below_datum_clamps_to_zero() {
        assert_eq!(level_m(4.5, 5.0).unwrap(), 0.0);
    }

    #[test]
    fn implausible_readings_rejected() {
        assert_eq!(level_m(4.5, 0.01), None); // inside blind zone
        assert_eq!(level_m(4.5, 9.0), None); // beyond sensor range
        assert_eq!(level_m(0.0, 1.0), None); // unconfigured mount height
    }
}
