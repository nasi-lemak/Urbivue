/*
 * Urbivue traffic counter prototype.
 * Sensor kind: vehicle_count (veh per interval) — feeds traffic analytics
 * and the counter-silent rule.
 *
 * Hardware: ESP32 + one of:
 *  - HB100 / RCWL-0516 doppler radar module (output to GPIO33), aimed across
 *    a single lane from a pole ~1 m high. Simple presence pulses; good
 *    enough for pilot volumes on one lane.
 *  - Retroreflective IR break-beam across a lane entry (same pin).
 *
 * Counting logic: a detection pulse train separated by >= GAP_MS counts as
 * one vehicle. Publishes the accumulated count every 5 minutes, then
 * resets — matching the platform's per-interval count convention.
 *
 * Prototype accuracy is roughly ±10-15 % on free-flowing single-lane
 * traffic; use commercial radar/loop counters where planning decisions
 * need survey-grade numbers (they integrate via POST /api/ingest).
 */
#include "../common/urbivue_device.h"

const UrbivueConfig CFG = {"YOUR_WIFI", "YOUR_PASS", "192.168.1.10", 1883, "tc-node-01"};
const char* SENSOR_ID = "TC-001-CNT";
const uint32_t REPORT_MS = 5UL * 60 * 1000;
const uint32_t GAP_MS = 800;  // min quiet time separating two vehicles

const int DETECT_PIN = 33;
UrbivueDevice device(CFG);
volatile uint32_t vehicles = 0;
volatile unsigned long lastDetectMs = 0;
unsigned long lastReport = 0;

void IRAM_ATTR onDetect() {
  unsigned long now = millis();
  if (now - lastDetectMs >= GAP_MS) vehicles++;
  lastDetectMs = now;  // extend the window while the same vehicle passes
}

void setup() {
  pinMode(DETECT_PIN, INPUT);
  attachInterrupt(digitalPinToInterrupt(DETECT_PIN), onDetect, RISING);
  device.begin();
}

void loop() {
  if (device.ensureConnected() && millis() - lastReport >= REPORT_MS) {
    noInterrupts();
    uint32_t count = vehicles;
    vehicles = 0;
    interrupts();
    if (device.publishReading(SENSOR_ID, (float)count)) lastReport = millis();
  }
  delay(100);
}
