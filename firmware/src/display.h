// Display + touch for the JC3248W535C (pins and init from the esp32-s3-jc3248w535c skill,
// cross-checked with the vendor/community demos - see docs/hardware-notes.md).
#pragma once
#include <Arduino_GFX_Library.h>

#define SCR_W 320
#define SCR_H 480

extern Arduino_Canvas *gfx;     // always draw through the canvas, then displayFlush()

bool displayBegin();
void displayFlush();
uint16_t *displayFb();
void backlightSet(uint8_t percent);

// Raw touch read. Returns true with portrait screen coordinates while a finger is down.
bool touchRead(int &x, int &y);
