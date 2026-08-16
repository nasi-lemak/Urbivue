/*
 * Urbivue rain gauge prototype.
 * Sensor kind: rainfall (mm/h) — feeds intense-rain rule + slope rain-watch.
 *
 * Hardware: ESP32 + tipping-bucket gauge (reed switch to GPIO27, internal
 * pull-up; each tip = MM_PER_TIP, typically 0.2794 mm — check your bucket's
 * datasheet). Mount level, away from walls/trees, funnel unobstructed.
 *
 * Reports the last-minute tip count scaled to mm/h, every 60 s.
 */
#include "../common/urbivue_device.h"

const UrbivueConfig CFG = {"YOUR_WIFI", "YOUR_PASS", "192.168.1.10", 1883, "rg-station-01"};
const char* SENSOR_ID = "RG-001";
const float MM_PER_TIP = 0.2794f;
const uint32_t REPORT_MS = 60000;
const int TIP_PIN = 27;

UrbivueDevice device(CFG);
volatile uint32_t tips = 0;
volatile unsigned long lastTipMs = 0;
unsigned long lastReport = 0;

void IRAM_ATTR onTip() {
  unsigned long now = millis();
  if (now - lastTipMs > 150) {  // reed-switch debounce
    tips++;
    lastTipMs = now;
  }
}

void setup() {
  pinMode(TIP_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(TIP_PIN), onTip, FALLING);
  device.begin();
}

void loop() {
  if (device.ensureConnected() && millis() - lastReport >= REPORT_MS) {
    noInterrupts();
    uint32_t windowTips = tips;
    tips = 0;
    interrupts();
    // tips-in-window (1 min) -> instantaneous rate in mm/h
    float mmPerHour = windowTips * MM_PER_TIP * (3600000.0f / REPORT_MS);
    if (device.publishReading(SENSOR_ID, mmPerHour)) lastReport = millis();
  }
  delay(100);
}
