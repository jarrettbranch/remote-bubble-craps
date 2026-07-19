/*
  Minimal ESP32-C3 USB serial smoke test.

  Arduino IDE:
    Tools -> USB CDC On Boot -> Enabled
    Serial Monitor baud -> 115200

  This sketch does not touch GPIO 4 or the roller circuit.
*/

#include <Arduino.h>

static constexpr uint32_t SERIAL_BAUD = 115200;
static constexpr uint32_t PRINT_EVERY_MS = 1000;

uint32_t nextPrintAt = 0;
uint32_t counter = 0;

bool timeReached(uint32_t now, uint32_t target) {
  return static_cast<int32_t>(now - target) >= 0;
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(1000);
  Serial.println();
  Serial.println("READY esp32-c3-serial-smoke-test");
  nextPrintAt = millis();
}

void loop() {
  uint32_t now = millis();

  if (timeReached(now, nextPrintAt)) {
    Serial.print("tick ");
    Serial.println(counter++);
    nextPrintAt = now + PRINT_EVERY_MS;
  }

  while (Serial.available() > 0) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    Serial.print("echo ");
    Serial.println(line);
  }
}
