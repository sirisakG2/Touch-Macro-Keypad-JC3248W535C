// Key names <-> USB HID usage codes (keyboard page 0x07), US layout.
// The web app's web/public/keys.js holds the same table; web/test/keymap.test.js checks they match.
#pragma once
#include <Arduino.h>

// Modifier bits in byte 0 of a keyboard report.
enum : uint8_t {
  MOD_LCTRL = 0x01, MOD_LSHIFT = 0x02, MOD_LALT = 0x04, MOD_LGUI = 0x08,
  MOD_RCTRL = 0x10, MOD_RSHIFT = 0x20, MOD_RALT = 0x40, MOD_RGUI = 0x80,
};

// Returns the HID usage for a key name ("a", "f5", "enter", "lctrl" ...), or 0 when unknown.
// Modifier keys return 0xE0..0xE7.
uint8_t keyUsage(const char *name);
// Modifier name ("ctrl", "shift", "alt", "gui", "lctrl", "rctrl", ...) -> bit, 0 when unknown.
uint8_t modBit(const char *name);
// ASCII char -> usage + whether shift is needed. Returns false for chars that can't be typed.
bool asciiToKey(char c, uint8_t &usage, bool &shift);
