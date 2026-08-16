/*
 * urbivue_device.h — shared plumbing for Urbivue prototype devices.
 *
 * Target: ESP32 (Arduino core). Library dependency: PubSubClient.
 * Handles Wi-Fi + MQTT connection with backoff, and publishes readings in
 * the platform's ingest contract:
 *
 *   topic:   urbivue/ingest/<SENSOR_EXTERNAL_ID>
 *   payload: {"value": <number>}
 *
 * The sensor must already be registered in Urbivue (POST /api/sensors) so
 * the external ID resolves — see docs/HARDWARE.md "Provisioning workflow".
 *
 * Prototype-grade: Wi-Fi + plaintext MQTT for bench and pilot use. For
 * street deployments move to LoRaWAN/NB-IoT via a gateway that forwards to
 * POST /api/ingest, and enable broker authentication (see HARDWARE.md §2).
 */
#pragma once
#include <WiFi.h>
#include <PubSubClient.h>

struct UrbivueConfig {
  const char* wifiSsid;
  const char* wifiPassword;
  const char* mqttHost;   // Urbivue broker (mosquitto), e.g. "192.168.1.10"
  uint16_t mqttPort;      // 1883
  const char* deviceName; // MQTT client id, unique per device
};

class UrbivueDevice {
 public:
  explicit UrbivueDevice(const UrbivueConfig& cfg) : cfg_(cfg), mqtt_(net_) {}

  void begin() {
    WiFi.mode(WIFI_STA);
    WiFi.begin(cfg_.wifiSsid, cfg_.wifiPassword);
    mqtt_.setServer(cfg_.mqttHost, cfg_.mqttPort);
    mqtt_.setBufferSize(256);
  }

  // Call from loop(); reconnects with backoff. Returns true when online.
  bool ensureConnected() {
    if (WiFi.status() != WL_CONNECTED) {
      if (millis() - lastWifiAttempt_ > 10000) {
        lastWifiAttempt_ = millis();
        WiFi.reconnect();
      }
      return false;
    }
    if (!mqtt_.connected()) {
      if (millis() - lastMqttAttempt_ > 5000) {
        lastMqttAttempt_ = millis();
        mqtt_.connect(cfg_.deviceName);
      }
      return mqtt_.connected();
    }
    mqtt_.loop();
    return true;
  }

  // Publish one reading for a sensor external id. Returns publish success.
  bool publishReading(const char* sensorExternalId, float value) {
    if (!mqtt_.connected()) return false;
    char topic[96];
    snprintf(topic, sizeof(topic), "urbivue/ingest/%s", sensorExternalId);
    char payload[48];
    snprintf(payload, sizeof(payload), "{\"value\":%.3f}", value);
    return mqtt_.publish(topic, payload);
  }

 private:
  UrbivueConfig cfg_;
  WiFiClient net_;
  PubSubClient mqtt_;
  unsigned long lastWifiAttempt_ = 0;
  unsigned long lastMqttAttempt_ = 0;
};
