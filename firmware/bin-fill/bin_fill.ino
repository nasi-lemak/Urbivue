/*
 * Urbivue bin fill-level prototype.
 * Sensor kind: fill_level (%) — feeds the near-full rule + collection list.
 *
 * Hardware: ESP32 + HC-SR04P (3.3 V) or JSN-SR04T mounted inside the bin
 * lid pointing down (TRIG=GPIO25, ECHO=GPIO26). BIN_DEPTH_M is lid sensor
 * face to bin floor, measured with the bin empty on installation.
 *
 * Battery powered: measures, publishes, deep-sleeps 30 minutes. At that
 * cadence a 18650 cell lasts months; pair with the estimated-fill fallback
 * for unsensored bins.
 */
#include "../common/urbivue_device.h"

const UrbivueConfig CFG = {"YOUR_WIFI", "YOUR_PASS", "192.168.1.10", 1883, "bin-01"};
const char* SENSOR_ID = "BIN-001-FILL";
const float BIN_DEPTH_M = 0.95f;
const uint64_t SLEEP_US = 30ULL * 60 * 1000000;

const int TRIG = 25, ECHO = 26;
UrbivueDevice device(CFG);

float readDistanceM() {
  digitalWrite(TRIG, LOW);  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long us = pulseIn(ECHO, HIGH, 20000);
  return us > 0 ? (us * 0.000343f) / 2.0f : -1.0f;
}

void setup() {
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  device.begin();
  unsigned long start = millis();
  while (!device.ensureConnected() && millis() - start < 30000) delay(200);

  // Best-of-5: waste surfaces are irregular; take the median.
  float d[5];
  int n = 0;
  for (int i = 0; i < 5; i++) {
    float m = readDistanceM();
    if (m > 0.02f) d[n++] = m;
    delay(80);
  }
  if (n >= 3) {
    for (int i = 1; i < n; i++)
      for (int j = i; j > 0 && d[j] < d[j - 1]; j--) {
        float t = d[j]; d[j] = d[j - 1]; d[j - 1] = t;
      }
    float fillPct = (1.0f - d[n / 2] / BIN_DEPTH_M) * 100.0f;
    device.publishReading(SENSOR_ID, constrain(fillPct, 0.0f, 100.0f));
    delay(500);
  }

  esp_sleep_enable_timer_wakeup(SLEEP_US);
  esp_deep_sleep_start();
}

void loop() {}
