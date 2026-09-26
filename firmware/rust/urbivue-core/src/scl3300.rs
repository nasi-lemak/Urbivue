//! Murata SCL3300 inclinometer (slope monitor) SPI frame handling.
//!
//! The SCL3300 speaks 32-bit SPI frames: an 8-bit opcode (read/write bit +
//! 5-bit register address, plus a 2-bit return-status field on responses),
//! 16 data bits, and a CRC-8 over the upper 24 bits. Responses are
//! "off-frame": the answer to request N arrives while clocking request N+1.
//!
//! Every response is CRC- and status-checked before its value is trusted,
//! mirroring the PZEM handling — a glitched SPI read must never become a
//! plausible tilt reading on a life-safety slope.

/// CRC-8 per the SCL3300 datasheet: poly x^8+x^4+x^3+x^2+1 (0x1D), seed
/// 0xFF, computed MSB-first over frame bits 31..8, result inverted.
pub fn crc8(frame: u32) -> u8 {
    let mut crc: u8 = 0xFF;
    for bit in (8..32).rev() {
        let bit_value = ((frame >> bit) & 1) as u8;
        let mut temp = crc & 0x80;
        if bit_value == 1 {
            temp ^= 0x80;
        }
        crc <<= 1;
        if temp != 0 {
            crc ^= 0x1D;
        }
    }
    !crc
}

/// Register addresses (bank 0).
pub mod reg {
    pub const ACC_X: u8 = 0x01;
    pub const ACC_Y: u8 = 0x02;
    pub const ACC_Z: u8 = 0x03;
    pub const STO: u8 = 0x04;
    pub const TEMP: u8 = 0x05;
    pub const STATUS: u8 = 0x06;
    pub const ANG_CTRL: u8 = 0x0C;
    pub const MODE: u8 = 0x0D;
    pub const WHOAMI: u8 = 0x10;
}

/// WHOAMI register content identifying an SCL3300.
pub const WHOAMI_VALUE: u16 = 0x00C1;

/// Inclination mode 4 (lowest noise): 12000 LSB per g.
pub const MODE4_LSB_PER_G: f32 = 12000.0;

/// Build a request frame (opcode + data + CRC).
pub fn request(write: bool, addr: u8, data: u16) -> u32 {
    let op = ((write as u32) << 7) | (((addr & 0x1F) as u32) << 2);
    let frame = (op << 24) | ((data as u32) << 8);
    frame | crc8(frame) as u32
}

pub fn read(addr: u8) -> u32 {
    request(false, addr, 0)
}

pub fn write(addr: u8, data: u16) -> u32 {
    request(true, addr, data)
}

/// Commands used by the start-up / shutdown sequence.
pub mod cmd {
    use super::{reg, write};
    /// Also the datasheet's "wake up from power-down" command.
    pub fn mode1() -> u32 {
        write(reg::MODE, 0x0000)
    }
    pub fn mode4() -> u32 {
        write(reg::MODE, 0x0003)
    }
    pub fn power_down() -> u32 {
        write(reg::MODE, 0x0004)
    }
    pub fn sw_reset() -> u32 {
        write(reg::MODE, 0x0020)
    }
    pub fn enable_angles() -> u32 {
        write(reg::ANG_CTRL, 0x001F)
    }
}

/// Response return status (frame bits 25..24).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReturnStatus {
    StartupInProgress,
    Normal,
    Reserved,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Response {
    pub addr: u8,
    pub status: ReturnStatus,
    pub data: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameError {
    Crc,
}

/// Parse and CRC-check a response frame.
pub fn parse(frame: u32) -> Result<Response, FrameError> {
    if crc8(frame) != (frame & 0xFF) as u8 {
        return Err(FrameError::Crc);
    }
    let status = match (frame >> 24) & 0b11 {
        0 => ReturnStatus::StartupInProgress,
        1 => ReturnStatus::Normal,
        2 => ReturnStatus::Reserved,
        _ => ReturnStatus::Error,
    };
    Ok(Response {
        addr: ((frame >> 26) & 0x1F) as u8,
        status,
        data: ((frame >> 8) & 0xFFFF) as u16,
    })
}

/// A value is only trustworthy if the frame is intact, the device reports
/// normal operation, and it answers the register we asked for.
pub fn checked_value(frame: u32, expected_addr: u8) -> Option<u16> {
    match parse(frame) {
        Ok(r) if r.status == ReturnStatus::Normal && r.addr == expected_addr => Some(r.data),
        _ => None,
    }
}

/// Acceleration in g from a raw two's-complement register value.
pub fn accel_g(raw: u16, lsb_per_g: f32) -> f32 {
    raw as i16 as f32 / lsb_per_g
}

/// Die temperature in °C (datasheet: T = -273 + raw / 18.9).
pub fn temperature_c(raw: u16) -> f32 {
    -273.0 + raw as f32 / 18.9
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tilt;

    /// Build a response frame as the sensor would send it.
    fn response(addr: u8, status: u32, data: u16) -> u32 {
        let frame = (((addr as u32) << 26) | (status << 24)) | ((data as u32) << 8);
        frame | crc8(frame) as u32
    }

    #[test]
    fn frame_builder_matches_datasheet_command_words() {
        // Published SCL3300 datasheet commands: reproducing them validates
        // the CRC implementation and opcode packing independently.
        assert_eq!(read(reg::ACC_X), 0x0400_00F7);
        assert_eq!(read(reg::ACC_Y), 0x0800_00FD);
        assert_eq!(read(reg::ACC_Z), 0x0C00_00FB);
        assert_eq!(read(reg::STO), 0x1000_00E9);
        assert_eq!(read(reg::TEMP), 0x1400_00EF);
        assert_eq!(read(reg::STATUS), 0x1800_00E5);
        assert_eq!(read(reg::WHOAMI), 0x4000_0091);
        assert_eq!(cmd::mode1(), 0xB400_001F);
        assert_eq!(cmd::mode4(), 0xB400_0338);
        assert_eq!(cmd::power_down(), 0xB400_046B);
        assert_eq!(cmd::sw_reset(), 0xB400_2098);
        assert_eq!(cmd::enable_angles(), 0xB000_1F6F);
    }

    #[test]
    fn valid_response_parses() {
        let r = parse(response(reg::ACC_X, 1, 0x1234)).unwrap();
        assert_eq!(r.addr, reg::ACC_X);
        assert_eq!(r.status, ReturnStatus::Normal);
        assert_eq!(r.data, 0x1234);
    }

    #[test]
    fn corrupted_frame_rejected() {
        let good = response(reg::ACC_Z, 1, 12000);
        for bit in 8..32 {
            assert_eq!(parse(good ^ (1 << bit)), Err(FrameError::Crc), "bit {bit}");
        }
    }

    #[test]
    fn error_or_startup_status_is_not_trusted() {
        assert_eq!(checked_value(response(reg::ACC_X, 3, 100), reg::ACC_X), None);
        assert_eq!(checked_value(response(reg::ACC_X, 0, 100), reg::ACC_X), None);
        assert_eq!(checked_value(response(reg::ACC_X, 1, 100), reg::ACC_X), Some(100));
    }

    #[test]
    fn off_frame_mismatch_is_not_trusted() {
        // Answer to a different register (e.g. a missed frame shifted the
        // off-frame pipeline) must not be read as the requested axis.
        assert_eq!(checked_value(response(reg::ACC_Y, 1, 100), reg::ACC_X), None);
    }

    #[test]
    fn unit_conversions() {
        assert!((accel_g(12000, MODE4_LSB_PER_G) - 1.0).abs() < 1e-6);
        assert!((accel_g((-6000i16) as u16, MODE4_LSB_PER_G) + 0.5).abs() < 1e-6);
        // 25 °C -> raw = (25 + 273) * 18.9 = 5632.2
        assert!((temperature_c(5632) - 25.0).abs() < 0.05);
    }

    #[test]
    fn sensor_frames_to_tilt() {
        // End to end: raw frames for a sensor leaned 0.5° (the critical
        // rate-of-change threshold) about the Y axis read back as 0.5°.
        let lean = 0.5f32.to_radians();
        let ax = (lean.sin() * MODE4_LSB_PER_G) as i16 as u16;
        let az = (lean.cos() * MODE4_LSB_PER_G) as i16 as u16;
        let frames = [response(reg::ACC_X, 1, ax), response(reg::ACC_Y, 1, 0), response(reg::ACC_Z, 1, az)];
        let v = [
            accel_g(checked_value(frames[0], reg::ACC_X).unwrap(), MODE4_LSB_PER_G),
            accel_g(checked_value(frames[1], reg::ACC_Y).unwrap(), MODE4_LSB_PER_G),
            accel_g(checked_value(frames[2], reg::ACC_Z).unwrap(), MODE4_LSB_PER_G),
        ];
        let baseline = tilt::normalize([0.0, 0.0, 1.0]).unwrap();
        let t = tilt::tilt_deg(tilt::normalize(v).unwrap(), baseline);
        assert!((t - 0.5).abs() < 0.01, "got {t}");
    }
}
