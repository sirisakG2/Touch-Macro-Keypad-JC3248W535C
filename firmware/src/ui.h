// Keypad screen: background, keycaps, press motion + light effects, idle ambience, status/page bars.
#pragma once
#include <Arduino.h>
#include "config.h"

#define STATUS_H 22
#define NAV_H 44

void uiBegin();
void uiReload();              // after cfg changed: reload images, clamp page, redraw
void uiApplyConfig(const Config &c);   // swap in a new config safely (touch runs on its own task)
float uiFrameMs();            // average render+flush time, for diagnostics
void uiLoop();                // touch + animation + throttled flush
void uiSetPage(int p);
int uiPage();
void uiBrightnessPreview(int percent);   // -1 = back to cfg.brightness
void uiMessage(const char *msg);          // small toast at the bottom (e.g. "Saved")
