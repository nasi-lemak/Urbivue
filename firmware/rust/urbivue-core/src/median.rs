//! Median filtering — the outlier defence for ultrasonic sensors (splash,
//! debris, irregular waste surfaces).

/// Median of the valid prefix of a sample buffer, in place. Returns None
/// when fewer than `min_samples` values are present.
pub fn median_in_place(samples: &mut [f32], min_samples: usize) -> Option<f32> {
    let n = samples.len();
    if n < min_samples || n == 0 {
        return None;
    }
    // Insertion sort: tiny fixed buffers, no allocation.
    for i in 1..n {
        let mut j = i;
        while j > 0 && samples[j] < samples[j - 1] {
            samples.swap(j, j - 1);
            j -= 1;
        }
    }
    Some(samples[n / 2])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_middle_value() {
        let mut s = [3.0, 1.0, 2.0];
        assert_eq!(median_in_place(&mut s, 3), Some(2.0));
    }

    #[test]
    fn rejects_outliers() {
        // Five sane pings and two splash artefacts.
        let mut s = [1.20, 1.22, 0.05, 1.21, 6.50, 1.19, 1.23];
        let m = median_in_place(&mut s, 3).unwrap();
        assert!((m - 1.21).abs() < 0.02);
    }

    #[test]
    fn refuses_too_few_samples() {
        let mut s = [1.0, 2.0];
        assert_eq!(median_in_place(&mut s, 3), None);
        let mut empty: [f32; 0] = [];
        assert_eq!(median_in_place(&mut empty, 0), None);
    }
}
