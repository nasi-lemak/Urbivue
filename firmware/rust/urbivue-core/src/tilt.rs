//! Slope monitor: tilt as the angle between the current gravity vector and
//! the baseline captured at commissioning.

use crate::math::{acos, sqrt, to_degrees};

/// Normalize a raw accelerometer vector. None for a near-zero vector
/// (sensor fault / free fall).
pub fn normalize(v: [f32; 3]) -> Option<[f32; 3]> {
    let mag = sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if mag < 1e-6 {
        return None;
    }
    Some([v[0] / mag, v[1] / mag, v[2] / mag])
}

/// Angle in degrees between two unit vectors (current gravity vs stored
/// baseline). This is the `tilt` value the platform's threshold and
/// rate-of-change rules consume.
pub fn tilt_deg(current: [f32; 3], baseline: [f32; 3]) -> f32 {
    let dot = current[0] * baseline[0] + current[1] * baseline[1] + current[2] * baseline[2];
    to_degrees(acos(dot))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_orientation_is_zero_tilt() {
        let g = normalize([0.1, -0.2, 9.8]).unwrap();
        assert!(tilt_deg(g, g) < 0.02);
    }

    #[test]
    fn known_two_degree_lean() {
        let baseline = normalize([0.0, 0.0, 1.0]).unwrap();
        let two_deg = 2.0f32.to_radians();
        let leaned = normalize([two_deg.sin(), 0.0, two_deg.cos()]).unwrap();
        let t = tilt_deg(leaned, baseline);
        assert!((t - 2.0).abs() < 0.05, "got {t}");
    }

    #[test]
    fn works_from_any_mounting_orientation() {
        // Sensor glued at a weird angle: baseline captures it; a further
        // 1.5° movement still reads as 1.5°.
        let base = normalize([3.0, 4.0, 5.0]).unwrap();
        let angle = 1.5f32.to_radians();
        // Rotate around an axis perpendicular to base (z-x plane component).
        let axis = normalize([-base[2], 0.0, base[0]]).unwrap();
        let (s, c) = (angle.sin(), angle.cos());
        // Rodrigues rotation of `base` around `axis`.
        let cross = [
            axis[1] * base[2] - axis[2] * base[1],
            axis[2] * base[0] - axis[0] * base[2],
            axis[0] * base[1] - axis[1] * base[0],
        ];
        let dot = axis[0] * base[0] + axis[1] * base[1] + axis[2] * base[2];
        let rotated = [
            base[0] * c + cross[0] * s + axis[0] * dot * (1.0 - c),
            base[1] * c + cross[1] * s + axis[1] * dot * (1.0 - c),
            base[2] * c + cross[2] * s + axis[2] * dot * (1.0 - c),
        ];
        let t = tilt_deg(normalize(rotated).unwrap(), base);
        assert!((t - 1.5).abs() < 0.05, "got {t}");
    }

    #[test]
    fn zero_vector_rejected() {
        assert_eq!(normalize([0.0, 0.0, 0.0]), None);
    }
}
