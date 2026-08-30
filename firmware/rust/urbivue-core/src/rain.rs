//! Tipping-bucket rain gauge: tips in a window -> rainfall rate.

/// Instantaneous rainfall rate in mm/h from bucket tips counted over a
/// window. None for a zero/invalid window or unconfigured bucket size.
pub fn mm_per_hour(tips: u32, mm_per_tip: f32, window_ms: u32) -> Option<f32> {
    if window_ms == 0 || mm_per_tip <= 0.0 {
        return None;
    }
    Some(tips as f32 * mm_per_tip * (3_600_000.0 / window_ms as f32))
}

/// Debouncer for the reed switch: returns true when a pulse at `now_ms`
/// counts as a real tip (>= `debounce_ms` since the previous accepted tip).
pub fn accept_tip(last_tip_ms: &mut u32, now_ms: u32, debounce_ms: u32) -> bool {
    if now_ms.wrapping_sub(*last_tip_ms) >= debounce_ms {
        *last_tip_ms = now_ms;
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_bucket_one_minute_window() {
        // 3 tips of 0.2794 mm in one minute == 50.3 mm/h — a heavy storm.
        let rate = mm_per_hour(3, 0.2794, 60_000).unwrap();
        assert!((rate - 50.292).abs() < 0.01);
    }

    #[test]
    fn no_rain_is_zero() {
        assert_eq!(mm_per_hour(0, 0.2794, 60_000).unwrap(), 0.0);
    }

    #[test]
    fn invalid_config_rejected() {
        assert_eq!(mm_per_hour(3, 0.0, 60_000), None);
        assert_eq!(mm_per_hour(3, 0.2794, 0), None);
    }

    #[test]
    fn debounce_rejects_switch_bounce() {
        let mut last = 0u32;
        assert!(accept_tip(&mut last, 1_000, 150));
        assert!(!accept_tip(&mut last, 1_050, 150)); // bounce, 50 ms later
        assert!(accept_tip(&mut last, 1_400, 150)); // real second tip
    }

    #[test]
    fn debounce_survives_millis_wraparound() {
        let mut last = u32::MAX - 50;
        assert!(accept_tip(&mut last, 100, 150)); // 150 ms across the wrap
    }
}
