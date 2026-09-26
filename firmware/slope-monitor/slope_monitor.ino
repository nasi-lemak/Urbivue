/*
 * Urbivue slope monitor.
 * Sensor kinds: tilt (deg), temperature (°C), optional piezometer (kPa) —
 * feeds the tilt threshold, 24 h rate-of-change, silence, and
 * groundwater-pressure rules.
 *
 * Hardware: ESP32 or ESP32-C3 (Seeed XIAO ESP32C3 recommended: onboard
 * Li-ion charger, lean deep-sleep draw) +
 *  - tilt: Murata SCL3300 inclinometer on SPI (recommended — low noise and
 *    low temperature drift, suitable for the 0.5°/24 h critical rule), or an
 *    MPU-6050 on I2C for bench work only (its temperature drift in a
 *    sun-heated box is comparable to that threshold). Select below.
 *  - temperature: published alongside tilt so residual thermal drift can be
 *    spotted on the chart and compensated if needed.
 *  - piezometer (optional): 4-20 mA pressure transducer in a standpipe,
 *    165 ohm shunt into ADS1115 (I2C). Set HAS_PIEZO accordingly.
 *
 * Mounting: anchor the box to a grouted rod, not surface soil, and shade it.
 *
 * Battery + solar powered: reads, publishes, powers the sensor down, then
 * deep-sleeps 10 minutes. "Tilt" is the angular deviation from the
 * orientation captured at commissioning — hold BOOT on power-up for 5 s to
 * store the current orientation as the zero baseline (recapture it whenever
 * the sensor or its mounting changes).
 *
 * If the sensor fails its identity/CRC checks, no tilt is published: the
 * platform's silence rule flags the dead monitor instead of it reporting a
 * plausible-looking wrong value.
 */
#include <Preferences.h>
#include <SPI.h>
#include <Wire.h>
#include "../common/urbivue_device.h"
#include "../common/scl3300_frames.h"

// 1 = SCL3300 (field), 0 = MPU-6050 (bench only).
#define TILT_SENSOR_SCL3300 1

const UrbivueConfig CFG = {"YOUR_WIFI", "YOUR_PASS", "192.168.1.10", 1883, "slope-mon-01"};
const char* TILT_SENSOR_ID = "TLT-001";
const char* TEMP_SENSOR_ID = "TLT-001-TEMP";
const char* PIEZO_SENSOR_ID = "PZ-001";
const bool HAS_PIEZO = false;
const uint64_t SLEEP_US = 10ULL * 60 * 1000000;  // 10 min

const int MPU_ADDR = 0x68, ADS_ADDR = 0x48;
#ifdef CONFIG_IDF_TARGET_ESP32C3
// ESP32-C3 (XIAO silkscreen labels in comments). GPIO8/9 are strapping
// pins and GPIO9 is the BOOT button, so SPI avoids the board's default SPI.
const int SDA_PIN = 6 /* D4 */, SCL_PIN = 7 /* D5 */, BASELINE_PIN = 9 /* BOOT */;
const int SPI_SCK = 4 /* D2 */, SPI_MISO = 5 /* D3 */, SPI_MOSI = 10 /* D10 */,
          SPI_CS = 3 /* D1 */;
#else
// Classic ESP32 DevKit: standard I2C and VSPI pins, BOOT button is GPIO0.
const int SDA_PIN = 21, SCL_PIN = 22, BASELINE_PIN = 0;
const int SPI_SCK = 18, SPI_MISO = 19, SPI_MOSI = 23, SPI_CS = 5;
#endif

const int GRAVITY_SAMPLES = 20;
Preferences prefs;
UrbivueDevice device(CFG);

#if TILT_SENSOR_SCL3300
// ---- SCL3300 over SPI ------------------------------------------------------
SPISettings sclSpi(2000000, MSBFIRST, SPI_MODE0);

uint32_t sclTransfer(uint32_t frame) {
  SPI.beginTransaction(sclSpi);
  digitalWrite(SPI_CS, LOW);
  uint32_t resp = 0;
  for (int shift = 24; shift >= 0; shift -= 8) {
    resp = (resp << 8) | SPI.transfer((uint8_t)(frame >> shift));
  }
  digitalWrite(SPI_CS, HIGH);
  SPI.endTransaction();
  delayMicroseconds(15);  // datasheet: >= 10 us CS high between frames
  return resp;
}

bool tiltBegin() {
  pinMode(SPI_CS, OUTPUT);
  digitalWrite(SPI_CS, HIGH);
  SPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI, SPI_CS);
  delay(1);
  sclTransfer(scl3300::cmdMode1());  // wake from power-down (harmless otherwise)
  delay(1);
  sclTransfer(scl3300::cmdSwReset());
  delay(1);
  sclTransfer(scl3300::cmdMode4());
  sclTransfer(scl3300::cmdEnableAngles());
  delay(100);  // mode 4 settling (generous)
  // Status must be read to clear start-up flags; responses are off-frame.
  sclTransfer(scl3300::readCmd(scl3300::reg::STATUS));
  sclTransfer(scl3300::readCmd(scl3300::reg::STATUS));
  uint32_t status = sclTransfer(scl3300::readCmd(scl3300::reg::WHOAMI));
  uint32_t who = sclTransfer(scl3300::readCmd(scl3300::reg::STATUS));
  scl3300::Response s = scl3300::parse(status);
  uint16_t id = 0;
  return s.crcOk && s.status == scl3300::NORMAL &&
         scl3300::checkedValue(who, scl3300::reg::WHOAMI, &id) && id == scl3300::WHOAMI_VALUE;
}

// Raw acceleration vector averaged over intact frames only.
bool readAccel(float v[3]) {
  using namespace scl3300;
  const uint8_t axes[3] = {reg::ACC_X, reg::ACC_Y, reg::ACC_Z};
  double sum[3] = {0, 0, 0};
  int good = 0;
  for (int i = 0; i < GRAVITY_SAMPLES; i++) {
    uint32_t resp[3];
    sclTransfer(readCmd(reg::ACC_X));
    resp[0] = sclTransfer(readCmd(reg::ACC_Y));
    resp[1] = sclTransfer(readCmd(reg::ACC_Z));
    resp[2] = sclTransfer(readCmd(reg::STATUS));
    uint16_t raw[3];
    bool ok = true;
    for (int a = 0; a < 3; a++) ok = ok && checkedValue(resp[a], axes[a], &raw[a]);
    if (ok) {
      for (int a = 0; a < 3; a++) sum[a] += accelG(raw[a], MODE4_LSB_PER_G);
      good++;
    }
    delay(25);
  }
  if (good < GRAVITY_SAMPLES * 3 / 5) return false;  // too many bad frames
  for (int a = 0; a < 3; a++) v[a] = sum[a] / good;
  return true;
}

bool readTemperature(float* c) {
  sclTransfer(scl3300::readCmd(scl3300::reg::TEMP));
  uint32_t resp = sclTransfer(scl3300::readCmd(scl3300::reg::STATUS));
  uint16_t raw;
  if (!scl3300::checkedValue(resp, scl3300::reg::TEMP, &raw)) return false;
  *c = scl3300::temperatureC(raw);
  return true;
}

void tiltSleep() { sclTransfer(scl3300::cmdPowerDown()); }

#else
// ---- MPU-6050 over I2C (bench only) -----------------------------------------
bool tiltBegin() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0);  // exit sleep mode
  bool ok = Wire.endTransmission() == 0;
  delay(100);
  return ok;
}

bool readAccel(float v[3]) {
  long sum[3] = {0, 0, 0};
  for (int i = 0; i < GRAVITY_SAMPLES; i++) {
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x3B);
    Wire.endTransmission(false);
    if (Wire.requestFrom(MPU_ADDR, 6) != 6) return false;
    for (int a = 0; a < 3; a++) sum[a] += (int16_t)(Wire.read() << 8 | Wire.read());
    delay(10);
  }
  for (int a = 0; a < 3; a++) v[a] = sum[a] / (float)GRAVITY_SAMPLES;
  return true;
}

bool readTemperature(float* c) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x41);
  Wire.endTransmission(false);
  if (Wire.requestFrom(MPU_ADDR, 2) != 2) return false;
  int16_t raw = (Wire.read() << 8) | Wire.read();
  *c = raw / 340.0f + 36.53f;
  return true;
}

void tiltSleep() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0x40);  // sleep
  Wire.endTransmission();
}
#endif

// Unit gravity vector (sensor-independent from here on).
bool readGravity(float g[3]) {
  if (!readAccel(g)) return false;
  float mag = sqrtf(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]);
  if (mag < 1e-6f) return false;
  for (int a = 0; a < 3; a++) g[a] /= mag;
  return true;
}

float tiltFromBaselineDeg(const float g[3]) {
  float b[3] = {prefs.getFloat("bx", 0), prefs.getFloat("by", 0), prefs.getFloat("bz", 1)};
  float dot = g[0] * b[0] + g[1] * b[1] + g[2] * b[2];
  dot = constrain(dot, -1.0f, 1.0f);
  return acosf(dot) * 57.2958f;
}

float readPiezoKpa() {
  // ADS1115 single-shot on AIN0, gain 1 (±4.096 V): mA over the 165R shunt,
  // mapped 4-20 mA -> 0-RANGE_KPA. Adjust RANGE_KPA to the transducer.
  const float RANGE_KPA = 200.0f;
  Wire.beginTransmission(ADS_ADDR);
  Wire.write(0x01); Wire.write(0xC3); Wire.write(0x83);
  Wire.endTransmission();
  delay(10);
  Wire.beginTransmission(ADS_ADDR);
  Wire.write(0x00);
  Wire.endTransmission(false);
  Wire.requestFrom(ADS_ADDR, 2);
  int16_t raw = (Wire.read() << 8) | Wire.read();
  float volts = raw * 4.096f / 32768.0f;
  float mA = volts / 0.165f;
  return constrain((mA - 4.0f) / 16.0f, 0.0f, 1.0f) * RANGE_KPA;
}

void setup() {
  Wire.begin(SDA_PIN, SCL_PIN);
  prefs.begin("urbivue");
  pinMode(BASELINE_PIN, INPUT_PULLUP);
  bool sensorOk = tiltBegin();

  if (sensorOk && digitalRead(BASELINE_PIN) == LOW) {  // BOOT held: capture zero baseline
    delay(5000);
    float g[3];
    if (readGravity(g)) {
      prefs.putFloat("bx", g[0]); prefs.putFloat("by", g[1]); prefs.putFloat("bz", g[2]);
    }
  }

  device.begin();
  unsigned long start = millis();
  while (!device.ensureConnected() && millis() - start < 30000) delay(200);

  float g[3], tempC;
  if (sensorOk && readGravity(g)) device.publishReading(TILT_SENSOR_ID, tiltFromBaselineDeg(g));
  if (sensorOk && readTemperature(&tempC)) device.publishReading(TEMP_SENSOR_ID, tempC);
  if (HAS_PIEZO) device.publishReading(PIEZO_SENSOR_ID, readPiezoKpa());
  delay(500);  // let MQTT flush

  tiltSleep();
  esp_sleep_enable_timer_wakeup(SLEEP_US);
  esp_deep_sleep_start();
}

void loop() {}  // never reached: deep sleep restarts from setup()
