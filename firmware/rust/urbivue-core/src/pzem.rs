//! PZEM-004T v3 (Modbus-RTU) frame handling for the lighting node.
//!
//! Improvement over the C++ sketch: responses are CRC-checked before the
//! power value is trusted — a corrupted UART byte can no longer masquerade
//! as a plausible reading.

/// Modbus CRC-16 (poly 0xA001, init 0xFFFF), transmitted low byte first.
pub fn crc16(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &byte in data {
        crc ^= byte as u16;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xA001;
            } else {
                crc >>= 1;
            }
        }
    }
    crc
}

/// The read-input-registers request the lighting node sends (10 registers
/// from 0x0000, broadcast address 0xF8).
pub const READ_REQUEST: [u8; 8] = [0xF8, 0x04, 0x00, 0x00, 0x00, 0x0A, 0x64, 0x64];

/// Parse real power (W) from a 25-byte read response. Validates length,
/// function code, byte count, and CRC. Power lives in registers 3–4,
/// low word first, in 0.1 W units.
pub fn parse_power_w(frame: &[u8]) -> Option<f32> {
    if frame.len() != 25 || frame[1] != 0x04 || frame[2] != 0x14 {
        return None;
    }
    let expected = crc16(&frame[..23]);
    let received = u16::from_le_bytes([frame[23], frame[24]]);
    if expected != received {
        return None;
    }
    let low = u16::from_be_bytes([frame[9], frame[10]]) as u32;
    let high = u16::from_be_bytes([frame[11], frame[12]]) as u32;
    Some(((high << 16) | low) as f32 * 0.1)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a syntactically valid response with the given raw power value.
    fn frame_with_power(power_tenths: u32) -> [u8; 25] {
        let mut f = [0u8; 25];
        f[0] = 0xF8;
        f[1] = 0x04;
        f[2] = 0x14;
        let low = (power_tenths & 0xFFFF) as u16;
        let high = (power_tenths >> 16) as u16;
        f[9..11].copy_from_slice(&low.to_be_bytes());
        f[11..13].copy_from_slice(&high.to_be_bytes());
        let crc = crc16(&f[..23]);
        f[23..25].copy_from_slice(&crc.to_le_bytes());
        f
    }

    #[test]
    fn request_frame_has_valid_crc() {
        let crc = crc16(&READ_REQUEST[..6]);
        assert_eq!(crc.to_le_bytes(), [READ_REQUEST[6], READ_REQUEST[7]]);
    }

    #[test]
    fn parses_led_luminaire_power() {
        // 118.4 W — a typical 120 W LED luminaire.
        let f = frame_with_power(1184);
        assert!((parse_power_w(&f).unwrap() - 118.4).abs() < 0.01);
    }

    #[test]
    fn parses_power_above_one_word() {
        // 7 kW crosses the 16-bit boundary (70000 tenths).
        let f = frame_with_power(70_000);
        assert!((parse_power_w(&f).unwrap() - 7000.0).abs() < 0.1);
    }

    #[test]
    fn corrupted_byte_is_rejected() {
        let mut f = frame_with_power(1184);
        f[10] ^= 0x40; // single flipped bit in the power field
        assert_eq!(parse_power_w(&f), None);
    }

    #[test]
    fn wrong_length_or_function_rejected() {
        assert_eq!(parse_power_w(&[0u8; 10]), None);
        let mut f = frame_with_power(1184);
        f[1] = 0x84; // Modbus exception flag
        assert_eq!(parse_power_w(&f), None);
    }
}
