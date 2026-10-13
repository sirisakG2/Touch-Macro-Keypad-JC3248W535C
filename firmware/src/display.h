// Display + touch for the JC3248W535C (pins and init from the esp32-s3-jc3248w535c skill,
// cross-checked with the vendor/community demos - see docs/hardware-notes.md).
#pragma once
#include <Arduino_GFX_Library.h>

// Physical panel: portrait 320x480 (the AXS15231B has no hardware rotation).
#define PHYS_W 320
#define PHYS_H 480

// Logical screen in the current orientation: 320x480 (rotation 0/2) or 480x320 (1/3).
extern int SCR_W, SCR_H;
extern Arduino_Canvas *gfx;     // logical drawing surface: always draw here, then displayFlush()

// 0 portrait, 1 landscape (keypad turned left), 2 portrait upside-down, 3 landscape (turned right).
// Rotations 1-3 draw into an offscreen canvas that displayFlush() rotates onto the panel.
void displaySetRotation(uint8_t rotation);
uint8_t displayRotation();

bool displayBegin();
void displayFlush();
uint16_t *displayFb();
void backlightSet(uint8_t percent);

// Touch read. Returns true with logical (rotated) screen coordinates while a finger is down.
bool touchRead(int &x, int &y);
