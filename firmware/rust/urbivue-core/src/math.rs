//! Minimal float math for `no_std` targets (core provides no sqrt/acos).
//! Accuracy is verified against std implementations in the tests below —
//! comfortably better than the 0.1° resolution of the sensors using it.

/// Newton–Raphson square root. Returns NaN for negative input.
pub fn sqrt(x: f32) -> f32 {
    if x < 0.0 {
        return f32::NAN;
    }
    if x == 0.0 {
        return 0.0;
    }
    let mut guess = if x >= 1.0 { x / 2.0 } else { 1.0 };
    for _ in 0..24 {
        guess = 0.5 * (guess + x / guess);
    }
    guess
}

/// Abramowitz & Stegun 4.4.45 polynomial approximation of acos, max error
/// ~2e-4 rad (~0.011°). Input clamped to [-1, 1]; result in radians.
pub fn acos(x: f32) -> f32 {
    let clamped = x.clamp(-1.0, 1.0);
    let negate = clamped < 0.0;
    let a = if negate { -clamped } else { clamped };
    let mut r = -0.018_729_9_f32;
    r = r * a + 0.074_261_0;
    r = r * a - 0.212_114_4;
    r = r * a + 1.570_728_8;
    r *= sqrt(1.0 - a);
    if negate {
        core::f32::consts::PI - r
    } else {
        r
    }
}

pub fn to_degrees(radians: f32) -> f32 {
    radians * 180.0 / core::f32::consts::PI
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqrt_matches_std() {
        for &x in &[0.0f32, 0.25, 1.0, 2.0, 9.81, 1000.0, 123456.78] {
            assert!((sqrt(x) - x.sqrt()).abs() < 1e-3, "sqrt({x})");
        }
        assert!(sqrt(-1.0).is_nan());
    }

    #[test]
    fn acos_matches_std_within_tolerance() {
        let mut x = -1.0f32;
        while x <= 1.0 {
            let err = (acos(x) - x.acos()).abs();
            assert!(err < 3e-4, "acos({x}) err {err}");
            x += 0.01;
        }
    }

    #[test]
    fn acos_clamps_out_of_range() {
        assert_eq!(acos(1.5), 0.0);
        assert!((acos(-1.5) - core::f32::consts::PI).abs() < 3e-4);
    }
}
