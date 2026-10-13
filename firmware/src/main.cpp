// Touch Macro Keypad - Guition JC3248W535C (ESP32-S3)
// USB HID keyboard when a PC has enumerated it, BLE HID keyboard otherwise.
// Layout, keycaps, effects and macros come from /config.json + /img/*.565, written by the web app.
#include <Arduino.h>
#include <FS.h>
#include <LittleFS.h>
#include "config.h"
#include "display.h"
#include "hid_out.h"
#include "macro.h"
#include "proto.h"
#include "ui.h"

void setup() {
  Serial.setRxBufferSize(16384);
  Serial.begin(115200);
  displayBegin();
  if (!LittleFS.begin(true)) {   // formats on first boot
    gfx->setTextSize(2);
    gfx->setTextColor(RGB565_RED);
    gfx->setCursor(10, 200);
    gfx->print("LittleFS failed");
    gfx->flush();
  }
  LittleFS.mkdir("/img");
  loadConfig();
  hidBegin(cfg.name.c_str());
  macroBegin();
  protoBegin();
  uiBegin();
}

void loop() {
  protoLoop();
  hidLoop();
  uiLoop();
  delay(4);
}
