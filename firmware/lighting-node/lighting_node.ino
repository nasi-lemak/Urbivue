/*
 * Urbivue lighting node prototype.
 * Sensor kind: power_draw (W) — feeds outage/day-burner/circuit-fault sweep.
 *
 * Hardware: ESP32 + PZEM-004T v3 power meter on the luminaire feed
 * (UART2: RX=GPIO16, TX=GPIO17; PZEM CT clipped around the lamp's live
 * conductor inside the pole access door). The PZEM measures real power, so
 * LED drivers with poor power factor still read correctly.
 *
 * Mains wiring is an electrician's job; the ESP32 side is isolated via the
 * PZEM's own optocouplers. Reports every 5 minutes (the sweep treats
 * readings older than 2 h as stale).
 *
 * Production note: commercial NEMA-socket smart nodes replace this whole
 * prototype per pole — point their vendor platform's webhook at
 * POST /api/ingest instead.
 */
#include "../common/urbivue_device.h"

const UrbivueConfig CFG = {"YOUR_WIFI", "YOUR_PASS", "192.168.1.10", 1883, "lamp-node-01"};
const char* SENSOR_ID = "LP-001-PWR";
const uint32_t REPORT_MS = 5UL * 60 * 1000;

UrbivueDevice device(CFG);
unsigned long lastReport = 0;

// Modbus CRC-16 (poly 0xA001) — reference implementation with unit tests
// lives in firmware/rust/urbivue-core/src/pzem.rs.
uint16_t crc16Modbus(const uint8_t* data, int len) {
  uint16_t crc = 0xFFFF;
  for (int i = 0; i < len; i++) {
    crc ^= data[i];
    for (int b = 0; b < 8; b++) {
      crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
    }
  }
  return crc;
}

// Minimal PZEM-004T v3 Modbus-RTU read of the power registers (no library).
float readPowerW() {
  const uint8_t req[] = {0xF8, 0x04, 0x00, 0x00, 0x00, 0x0A, 0x64, 0x64};
  while (Serial2.available()) Serial2.read();
  Serial2.write(req, sizeof(req));
  unsigned long start = millis();
  uint8_t buf[25];
  int n = 0;
  while (millis() - start < 200 && n < 25) {
    if (Serial2.available()) buf[n++] = Serial2.read();
  }
  if (n < 25 || buf[1] != 0x04 || buf[2] != 0x14) return -1.0f;
  // Reject frames with a corrupted byte instead of trusting them.
  uint16_t crc = crc16Modbus(buf, 23);
  if (buf[23] != (crc & 0xFF) || buf[24] != (crc >> 8)) return -1.0f;
  // Power: registers 3-4 (0.1 W units), low word first.
  uint32_t raw = ((uint32_t)buf[9] << 8 | buf[10]) | ((uint32_t)(buf[11] << 8 | buf[12]) << 16);
  return raw * 0.1f;
}

void setup() {
  Serial2.begin(9600, SERIAL_8N1, 16, 17);
  device.begin();
}

void loop() {
  if (device.ensureConnected() && millis() - lastReport >= REPORT_MS) {
    float watts = readPowerW();
    if (watts >= 0 && device.publishReading(SENSOR_ID, watts)) {
      lastReport = millis();
    }
  }
  delay(100);
}
