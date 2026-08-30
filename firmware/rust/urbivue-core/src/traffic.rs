//! Traffic counter: detection pulses -> vehicle counts.
//!
//! A doppler/IR module emits a burst of pulses while one vehicle passes;
//! bursts separated by at least `gap_ms` of quiet count as distinct
//! vehicles.

pub struct GapCounter {
    gap_ms: u32,
    last_detect_ms: Option<u32>,
    count: u32,
}

impl GapCounter {
    pub fn new(gap_ms: u32) -> Self {
        Self {
            gap_ms,
            last_detect_ms: None,
            count: 0,
        }
    }

    /// Feed one detection pulse; extends the current vehicle's window.
    pub fn on_pulse(&mut self, now_ms: u32) {
        let new_vehicle = match self.last_detect_ms {
            None => true,
            Some(last) => now_ms.wrapping_sub(last) >= self.gap_ms,
        };
        if new_vehicle {
            self.count += 1;
        }
        self.last_detect_ms = Some(now_ms);
    }

    /// Drain the interval count (called at each report boundary).
    pub fn take(&mut self) -> u32 {
        core::mem::replace(&mut self.count, 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pulse_bursts_count_as_single_vehicles() {
        let mut c = GapCounter::new(800);
        // Vehicle 1: burst of 4 pulses over 300 ms.
        for t in [0, 100, 200, 300] {
            c.on_pulse(t);
        }
        // Quiet gap, then vehicle 2.
        for t in [1500, 1600] {
            c.on_pulse(t);
        }
        assert_eq!(c.take(), 2);
    }

    #[test]
    fn take_resets_the_interval() {
        let mut c = GapCounter::new(800);
        c.on_pulse(0);
        assert_eq!(c.take(), 1);
        assert_eq!(c.take(), 0);
        c.on_pulse(5000);
        assert_eq!(c.take(), 1);
    }

    #[test]
    fn tailgater_within_gap_is_not_double_counted() {
        let mut c = GapCounter::new(800);
        c.on_pulse(0);
        c.on_pulse(700); // still inside the gap window
        assert_eq!(c.take(), 1);
    }
}
