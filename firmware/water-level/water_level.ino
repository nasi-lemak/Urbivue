/*
 * Urbivue water-level station prototype.
 * Sensor kind: water_level (m) — feeds flood thresholds & rapid-rise rules.
 *
 * Hardware: ESP32 + JSN-SR04T waterproof ultrasonic (TRIG=GPIO25, ECHO=GPIO26,
 * echo through a 5V->3.3V divider). Mount the transducer face-down over the
 * water on a bridge/gantry; MOUNT_HEIGHT_M is transducer face to the zero
 * datum (riverbed or gauge zero). Level = mount height - measured distance.
 *
 * Reports every 60 s (well inside the seeded 10-min silence rule).
 */
#include "../common/urbivue_device.h"

const UrbivueConfig CFG = {"YOUR_WIFI", "YOUR_PASS", "192.168.1.10", 1883, "wl-station-01"};
const char* SENSOR_ID = "WL-001";      // registered via POST /api/sensors
const float MOUNT_HEIGHT_M = 4.50f;    // measure on installation day
const uint32_t REPORT_MS = 60000;

const int TRIG = 25, ECHO = 26;
UrbivueDevice device(CFG);
unsigned long lastReport = 0;

float readDistanceM() {
  digitalWrite(TRIG, LOW);  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long us = pulseIn(ECHO, HIGH, 40000);      // ~7 m max range
  return us > 0 ? (us * 0.000343f) / 2.0f : -1.0f;
}

// Median of 7 pings rejects splash/debris outliers.
float readLevelM() {
  float d[7];
  int n = 0;
  for (int i = 0; i < 7; i++) {
    float m = readDistanceM();
    if (m > 0.05f) d[n++] = m;
    delay(60);
  }
  if (n < 3) return NAN;
  for (int i = 1; i < n; i++)                 // insertion sort
    for (int j = i; j > 0 && d[j] < d[j - 1]; j--) {
      float t = d[j]; d[j] = d[j - 1]; d[j - 1] = t;
    }
  float level = MOUNT_HEIGHT_M - d[n / 2];
  return level < 0 ? 0 : level;
}

void setup() {
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  device.begin();
}

void loop() {
  if (device.ensureConnected() && millis() - lastReport >= REPORT_MS) {
    float level = readLevelM();
    if (!isnan(level) && device.publishReading(SENSOR_ID, level)) {
      lastReport = millis();
    }
  }
  delay(100);
}
