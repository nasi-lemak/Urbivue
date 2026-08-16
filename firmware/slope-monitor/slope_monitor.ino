/*
 * Urbivue slope monitor prototype.
 * Sensor kinds: tilt (deg) + optional piezometer (kPa) — feeds the tilt
 * threshold, 24 h rate-of-change, and groundwater-pressure rules.
 *
 * Hardware: ESP32 +
 *  - tilt: MPU-6050 accelerometer (I2C SDA=21 SCL=22), potted in epoxy
 *    inside an IP67 box anchored to the slope face or a short grouted rod.
 *  - piezometer (optional): 4-20 mA pressure transducer in a standpipe,
 *    165 ohm shunt into ADS1115 (also I2C). Set HAS_PIEZO accordingly.
 *
 * Battery + solar powered: reads, publishes, then deep-sleeps 10 minutes.
 * "Tilt" is the angular deviation from the orientation captured during
 * commissioning (mount is never perfectly level) — hold BOOT on power-up
 * for 5 s to store the current orientation as the zero baseline in NVS.
 */
#include <Preferences.h>
#include <Wire.h>
#include "../common/urbivue_device.h"

const UrbivueConfig CFG = {"YOUR_WIFI", "YOUR_PASS", "192.168.1.10", 1883, "slope-mon-01"};
const char* TILT_SENSOR_ID = "TLT-001";
const char* PIEZO_SENSOR_ID = "PZ-001";
const bool HAS_PIEZO = false;
const uint64_t SLEEP_US = 10ULL * 60 * 1000000;  // 10 min

const int MPU_ADDR = 0x68, ADS_ADDR = 0x48, BASELINE_PIN = 0;
Preferences prefs;
UrbivueDevice device(CFG);

void mpuWake() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B); Wire.write(0);  // exit sleep mode
  Wire.endTransmission();
}

// Unit gravity vector from a 20-sample average.
void readGravity(float g[3]) {
  long sum[3] = {0, 0, 0};
  for (int i = 0; i < 20; i++) {
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x3B);
    Wire.endTransmission(false);
    Wire.requestFrom(MPU_ADDR, 6);
    for (int a = 0; a < 3; a++) sum[a] += (int16_t)(Wire.read() << 8 | Wire.read());
    delay(10);
  }
  float mag = 0;
  for (int a = 0; a < 3; a++) { g[a] = sum[a] / 20.0f; mag += g[a] * g[a]; }
  mag = sqrtf(mag);
  for (int a = 0; a < 3; a++) g[a] /= mag;
}

float tiltFromBaselineDeg() {
  float g[3];
  readGravity(g);
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
  Wire.begin();
  prefs.begin("urbivue");
  pinMode(BASELINE_PIN, INPUT_PULLUP);
  mpuWake();
  delay(100);

  if (digitalRead(BASELINE_PIN) == LOW) {  // BOOT held: capture zero baseline
    delay(5000);
    float g[3];
    readGravity(g);
    prefs.putFloat("bx", g[0]); prefs.putFloat("by", g[1]); prefs.putFloat("bz", g[2]);
  }

  device.begin();
  unsigned long start = millis();
  while (!device.ensureConnected() && millis() - start < 30000) delay(200);

  device.publishReading(TILT_SENSOR_ID, tiltFromBaselineDeg());
  if (HAS_PIEZO) device.publishReading(PIEZO_SENSOR_ID, readPiezoKpa());
  delay(500);  // let MQTT flush

  esp_sleep_enable_timer_wakeup(SLEEP_US);
  esp_deep_sleep_start();
}

void loop() {}  // never reached: deep sleep restarts from setup()
