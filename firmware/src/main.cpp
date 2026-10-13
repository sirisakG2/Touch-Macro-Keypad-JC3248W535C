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

static void splash() {
  gfx->fillScreen(0x0841);
  gfx->setTextColor(RGB565_WHITE);
  gfx->setTextSize(3);
  const char *t = "Macro Keypad";
  gfx->setCursor((SCR_W - (int)strlen(t) * 18) / 2, 200);
  gfx->print(t);
  gfx->setTextSize(2);
  gfx->setTextColor(0x5D1F);
  String v = String("v") + FW_VERSION;
  gfx->setCursor((SCR_W - (int)v.length() * 12) / 2, 240);
  gfx->print(v);
  gfx->flush();
}

void setup() {
  Serial.setRxBufferSize(16384);
  Serial.begin(115200);
  displayBegin();
  splash();
  uint32_t splashT = millis();
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
  while (millis() - splashT < 1200) delay(10);   // keep the version on screen long enough to read
  uiBegin();
  uiMessage("v" FW_VERSION);
}

void loop() {
  protoLoop();
  hidLoop();
  uiLoop();
  delay(4);
}
