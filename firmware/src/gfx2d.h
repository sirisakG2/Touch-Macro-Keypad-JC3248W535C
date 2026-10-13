// Small software renderer working directly on the RGB565 canvas framebuffer:
// anti-aliased rounded rects, glows, rings and scaled alpha blits for keycap images.
#pragma once
#include <Arduino.h>

struct Img565 {            // /img/*.565 file: "K5" magic, version, flags, w, h (LE), pixels, [alpha]
  uint16_t w = 0, h = 0;
  uint16_t *px = nullptr;  // PSRAM
  uint8_t *a = nullptr;    // PSRAM, nullptr = opaque
};

bool imgLoad(const char *path, Img565 &img);
void imgFree(Img565 &img);

uint16_t blend565(uint16_t dst, uint16_t src, uint8_t a);
uint16_t scale565(uint16_t c, float k);          // brightness, k 0..1+
uint16_t hsv565(float h, float s, float v);       // h in degrees

void fillRoundRectAA(uint16_t *fb, float x, float y, float w, float h, float r, uint16_t c, float alpha = 1.f);
// Glow outside a rounded rect. With bgMask, only pixels still equal to the background are tinted,
// so glows never paint over neighbouring keys and need no key redraw on top.
void glowRoundRect(uint16_t *fb, float x, float y, float w, float h, float r, float spread, uint16_t c, float alpha,
                   const uint16_t *bgMask = nullptr);
// Copies a rectangle of src (full-screen buffer) into fb.
void copyRect(uint16_t *fb, const uint16_t *src, int x, int y, int w, int h);
void outlineRoundRect(uint16_t *fb, float x, float y, float w, float h, float r, float thick, uint16_t c, float alpha);
void ringAA(uint16_t *fb, float cx, float cy, float radius, float thick, uint16_t c, float alpha);
void fillRectBlend(uint16_t *fb, int x, int y, int w, int h, uint16_t c, uint8_t a);
void verticalGradient(uint16_t *fb, int y0, int h, uint16_t top, uint16_t bottom);
// Draws img scaled into the dest rect (nearest neighbour), clipped to a rounded rect of radius r, dimmed by k.
void blitScaled(uint16_t *fb, const Img565 &img, float x, float y, float w, float h, float k);
