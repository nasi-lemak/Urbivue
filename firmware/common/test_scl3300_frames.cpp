// Host test for scl3300_frames.h (run in CI):
//   g++ -std=c++17 -Wall -Wextra -Werror firmware/common/test_scl3300_frames.cpp -o t && ./t
#include <cmath>
#include <cstdio>
#include "scl3300_frames.h"

using namespace scl3300;
static int failures = 0;
#define CHECK(cond)                                         \
  do {                                                      \
    if (!(cond)) {                                          \
      std::printf("FAIL line %d: %s\n", __LINE__, #cond);   \
      failures++;                                           \
    }                                                       \
  } while (0)

static uint32_t response(uint8_t addr, uint32_t status, uint16_t data) {
  uint32_t frame = ((uint32_t)addr << 26) | (status << 24) | ((uint32_t)data << 8);
  return frame | crc8(frame);
}

int main() {
  // Datasheet command words (must match the Rust core byte for byte).
  CHECK(readCmd(reg::ACC_X) == 0x040000F7u);
  CHECK(readCmd(reg::ACC_Y) == 0x080000FDu);
  CHECK(readCmd(reg::ACC_Z) == 0x0C0000FBu);
  CHECK(readCmd(reg::STO) == 0x100000E9u);
  CHECK(readCmd(reg::TEMP) == 0x140000EFu);
  CHECK(readCmd(reg::STATUS) == 0x180000E5u);
  CHECK(readCmd(reg::WHOAMI) == 0x40000091u);
  CHECK(cmdMode1() == 0xB400001Fu);
  CHECK(cmdMode4() == 0xB4000338u);
  CHECK(cmdPowerDown() == 0xB400046Bu);
  CHECK(cmdSwReset() == 0xB4002098u);
  CHECK(cmdEnableAngles() == 0xB0001F6Fu);

  uint16_t v = 0;
  CHECK(checkedValue(response(reg::ACC_X, NORMAL, 0x1234), reg::ACC_X, &v) && v == 0x1234);

  // Any single flipped bit is caught.
  uint32_t good = response(reg::ACC_Z, NORMAL, 12000);
  for (int bit = 8; bit < 32; bit++) CHECK(!parse(good ^ (1u << bit)).crcOk);

  // Error/startup status and off-frame address mismatch are rejected.
  CHECK(!checkedValue(response(reg::ACC_X, ERROR, 100), reg::ACC_X, &v));
  CHECK(!checkedValue(response(reg::ACC_X, STARTUP, 100), reg::ACC_X, &v));
  CHECK(!checkedValue(response(reg::ACC_Y, NORMAL, 100), reg::ACC_X, &v));

  CHECK(std::fabs(accelG(12000, MODE4_LSB_PER_G) - 1.0f) < 1e-6f);
  CHECK(std::fabs(accelG((uint16_t)(int16_t)-6000, MODE4_LSB_PER_G) + 0.5f) < 1e-6f);
  CHECK(std::fabs(temperatureC(5632) - 25.0f) < 0.05f);

  if (failures) return 1;
  std::printf("scl3300_frames: all checks passed\n");
  return 0;
}
