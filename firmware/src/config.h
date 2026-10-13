// Runtime config: parsed from /config.json on LittleFS (written by the web app).
#pragma once
#include <Arduino.h>
#include <vector>

enum ActType : uint8_t { ACT_COMBO, ACT_TEXT, ACT_DELAY, ACT_DOWN, ACT_UP };
enum Motion  : uint8_t { MO_NONE, MO_PUSH, MO_POP, MO_SINK, MO_BOUNCE };
enum Light   : uint8_t { LI_NONE, LI_GLOW, LI_RIPPLE, LI_FLASH, LI_OUTLINE };
enum Idle    : uint8_t { ID_NONE, ID_BREATHE, ID_RAINBOW, ID_WAVE };

// Firmware limits; mirrored in web/public/schema.js LIMITS.
#define MAX_PAGES        16
#define MAX_KEYS         40
#define MAX_ACTIONS      200
#define MAX_TEXT         1024
#define MAX_DELAY_MS     10000
#define CONFIG_MAX_BYTES (256 * 1024)

struct Action {
  ActType t;
  uint8_t mods = 0;   // combo
  uint8_t key = 0;    // combo/down/up usage
  uint16_t ms = 0;    // delay
  String text;        // text
};

struct KeyDef {
  int16_t x, y, w, h;
  uint8_t r = 12;
  uint16_t color = 0x2945, textColor = 0xFFFF, fxColor = 0x07FF;
  uint8_t fontSize = 2;
  String label, img;
  Motion motion = MO_PUSH;
  Light light = LI_GLOW;
  uint16_t fxMs = 260;
  std::vector<Action> actions;
};

struct PageDef {
  String name;
  uint16_t bg = 0x0841, bg2 = 0x0841;
  bool gradient = false;
  String bgImg;
  std::vector<KeyDef> keys;
};

struct Config {
  String name = "Macro Keypad";
  uint8_t brightness = 80;      // %
  bool statusBar = true;
  uint16_t dimAfter = 120;      // s, 0 = never
  uint8_t dimLevel = 10;        // %
  Idle idle = ID_BREATHE;
  uint16_t idleAfter = 20;      // s
  uint16_t idleColor = 0x055F;
  uint8_t idleSpeed = 40;       // 1..100
  std::vector<PageDef> pages;
};

extern Config cfg;

// Parses JSON text into `out`. Returns "" on success, else an error message.
String parseConfig(const char *json, size_t len, Config &out);
// Loads /config.json (or the built-in default) into cfg.
String loadConfig();
uint16_t hexTo565(const char *hex, uint16_t fallback);
