/*
 * scl3300_frames.h — Murata SCL3300 inclinometer SPI frame handling.
 *
 * Pure logic (no Arduino dependencies) so it is host-tested by
 * test_scl3300_frames.cpp in CI; mirrors rust/urbivue-core/src/scl3300.rs.
 *
 * 32-bit frames: opcode (R/W bit + 5-bit address; responses also carry a
 * 2-bit return status), 16 data bits, CRC-8 over bits 31..8. Responses are
 * off-frame: the answer to request N arrives while clocking request N+1.
 * Every response is CRC-, status- and address-checked before use.
 */
#pragma once
#include <stdint.h>

namespace scl3300 {

// CRC-8 per datasheet: poly 0x1D, seed 0xFF, MSB-first over bits 31..8, inverted.
inline uint8_t crc8(uint32_t frame) {
  uint8_t crc = 0xFF;
  for (int bit = 31; bit > 7; bit--) {
    uint8_t temp = crc & 0x80;
    if ((frame >> bit) & 1) temp ^= 0x80;
    crc <<= 1;
    if (temp) crc ^= 0x1D;
  }
  return (uint8_t)~crc;
}

namespace reg {
constexpr uint8_t ACC_X = 0x01, ACC_Y = 0x02, ACC_Z = 0x03, STO = 0x04, TEMP = 0x05,
                  STATUS = 0x06, ANG_CTRL = 0x0C, MODE = 0x0D, WHOAMI = 0x10;
}

constexpr uint16_t WHOAMI_VALUE = 0x00C1;
constexpr float MODE4_LSB_PER_G = 12000.0f;  // inclination mode 4, lowest noise

inline uint32_t request(bool write, uint8_t addr, uint16_t data) {
  uint32_t op = ((uint32_t)write << 7) | ((uint32_t)(addr & 0x1F) << 2);
  uint32_t frame = (op << 24) | ((uint32_t)data << 8);
  return frame | crc8(frame);
}
inline uint32_t readCmd(uint8_t addr) { return request(false, addr, 0); }
inline uint32_t writeCmd(uint8_t addr, uint16_t data) { return request(true, addr, data); }

// Mode 1 write doubles as the datasheet's wake-up-from-power-down command.
inline uint32_t cmdMode1() { return writeCmd(reg::MODE, 0x0000); }
inline uint32_t cmdMode4() { return writeCmd(reg::MODE, 0x0003); }
inline uint32_t cmdPowerDown() { return writeCmd(reg::MODE, 0x0004); }
inline uint32_t cmdSwReset() { return writeCmd(reg::MODE, 0x0020); }
inline uint32_t cmdEnableAngles() { return writeCmd(reg::ANG_CTRL, 0x001F); }

enum ReturnStatus : uint8_t { STARTUP = 0, NORMAL = 1, RESERVED = 2, ERROR = 3 };

struct Response {
  bool crcOk;
  uint8_t addr;
  uint8_t status;
  uint16_t data;
};

inline Response parse(uint32_t frame) {
  Response r;
  r.crcOk = crc8(frame) == (uint8_t)(frame & 0xFF);
  r.addr = (frame >> 26) & 0x1F;
  r.status = (frame >> 24) & 0x03;
  r.data = (frame >> 8) & 0xFFFF;
  return r;
}

// True (and *out set) only for an intact, normal-status answer to expectedAddr.
inline bool checkedValue(uint32_t frame, uint8_t expectedAddr, uint16_t* out) {
  Response r = parse(frame);
  if (!r.crcOk || r.status != NORMAL || r.addr != expectedAddr) return false;
  *out = r.data;
  return true;
}

inline float accelG(uint16_t raw, float lsbPerG) { return (int16_t)raw / lsbPerG; }
inline float temperatureC(uint16_t raw) { return -273.0f + raw / 18.9f; }

}  // namespace scl3300
