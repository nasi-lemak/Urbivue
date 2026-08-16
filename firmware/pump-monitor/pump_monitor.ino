/*
 * Urbivue pump monitor prototype.
 * Sensor kinds: run_status (0/1) + current (A) — feeds the readiness board,
 * flood interlock, and overcurrent rule.
 *
 * Hardware: ESP32 +
 *  - run status: voltage-free auxiliary contact from the pump contactor,
 *    wired to GPIO32 with internal pull-up (closed = running). NEVER wire
 *    mains into the ESP32 — the aux contact is isolated by design.
 *  - current: SCT-013-000 clip-on CT around ONE motor phase, 33 ohm burden
 *    + 1.65 V bias divider into ADC GPIO34. Calibrate CT_A_PER_V against a
 *    clamp meter on commissioning.
 *
 * Electrical work inside the starter panel must be done by an electrician.
 * Reports every 30 s.
 */
#include "../common/urbivue_device.h"

const UrbivueConfig CFG = {"YOUR_WIFI", "YOUR_PASS", "192.168.1.10", 1883, "pump-mon-01"};
const char* RUN_SENSOR_ID = "PMP-001-RUN";
const char* AMP_SENSOR_ID = "PMP-001-AMP";
const float CT_A_PER_V = 30.0f;  // SCT-013-000 with 33R burden ≈ 30 A/V
const uint32_t REPORT_MS = 30000;

const int RUN_PIN = 32, CT_PIN = 34;
UrbivueDevice device(CFG);
unsigned long lastReport = 0;

// RMS over ~10 mains cycles (50 Hz -> 200 ms of samples).
float readCurrentA() {
  const int N = 400;
  float sumSq = 0;
  float offset = 1.65f;  // bias midpoint; refine with a no-load calibration
  for (int i = 0; i < N; i++) {
    float v = analogReadMilliVolts(CT_PIN) / 1000.0f - offset;
    sumSq += v * v;
    delayMicroseconds(500);
  }
  return sqrtf(sumSq / N) * CT_A_PER_V;
}

void setup() {
  pinMode(RUN_PIN, INPUT_PULLUP);
  analogSetPinAttenuation(CT_PIN, ADC_11db);
  device.begin();
}

void loop() {
  if (device.ensureConnected() && millis() - lastReport >= REPORT_MS) {
    bool running = digitalRead(RUN_PIN) == LOW;  // contact closed to GND
    bool ok = device.publishReading(RUN_SENSOR_ID, running ? 1.0f : 0.0f);
    ok &= device.publishReading(AMP_SENSOR_ID, running ? readCurrentA() : 0.0f);
    if (ok) lastReport = millis();
  }
  delay(100);
}
