#include "display.h"
#include <Wire.h>

#define GFX_BL 1
#define TOUCH_SDA 4
#define TOUCH_SCL 8
#define TOUCH_ADDR 0x3B

static Arduino_DataBus *bus = new Arduino_ESP32QSPI(45 /*CS*/, 47 /*SCK*/, 21 /*D0*/, 48 /*D1*/, 40 /*D2*/, 39 /*D3*/);
static Arduino_GFX *panel = new Arduino_AXS15231B(bus, GFX_NOT_DEFINED, 0, false, SCR_W, SCR_H);
Arduino_Canvas *gfx = new Arduino_Canvas(SCR_W, SCR_H, panel, 0, 0, 0);

bool displayBegin() {
  if (!gfx->begin(40000000)) return false;     // 40 MHz QSPI: default clock is slow
  ledcAttach(GFX_BL, 5000, 8);
  backlightSet(80);
  Wire.begin(TOUCH_SDA, TOUCH_SCL);
  Wire.setClock(400000);
  gfx->fillScreen(RGB565_BLACK);
  gfx->flush();
  return true;
}

void displayFlush() { gfx->flush(); }
uint16_t *displayFb() { return gfx->getFramebuffer(); }

void backlightSet(uint8_t percent) {
  percent = min<uint8_t>(percent, 100);
  ledcWrite(GFX_BL, (uint32_t)percent * 255 / 100);
}

bool touchRead(int &x, int &y) {
  static const uint8_t cmd[8] = {0xB5, 0xAB, 0xA5, 0x5A, 0, 0, 0, 8};
  uint8_t b[8];
  Wire.beginTransmission(TOUCH_ADDR);
  Wire.write(cmd, 8);
  if (Wire.endTransmission() != 0) return false;
  if (Wire.requestFrom(TOUCH_ADDR, 8) != 8) return false;
  for (int i = 0; i < 8; i++) b[i] = Wire.read();
  if (b[1] == 0 || b[1] > 4) return false;      // b[1] = touch count
  x = ((b[2] & 0x0F) << 8) | b[3];
  y = ((b[4] & 0x0F) << 8) | b[5];
  if (x >= SCR_W || y >= SCR_H) return false;
  return true;
}
