#include "display.h"
#include <Wire.h>

#define GFX_BL 1
#define TOUCH_SDA 4
#define TOUCH_SCL 8
#define TOUCH_ADDR 0x3B

static Arduino_DataBus *bus = new Arduino_ESP32QSPI(45 /*CS*/, 47 /*SCK*/, 21 /*D0*/, 48 /*D1*/, 40 /*D2*/, 39 /*D3*/);
static Arduino_GFX *panel = new Arduino_AXS15231B(bus, GFX_NOT_DEFINED, 0, false, PHYS_W, PHYS_H);
static Arduino_Canvas *panelCanvas = new Arduino_Canvas(PHYS_W, PHYS_H, panel, 0, 0, 0);
static Arduino_Canvas *landCanvas = nullptr, *flipCanvas = nullptr;   // offscreen surfaces, made on demand
static volatile uint8_t rot = 0;
int SCR_W = PHYS_W, SCR_H = PHYS_H;
Arduino_Canvas *gfx = panelCanvas;

bool displayBegin() {
  if (!panelCanvas->begin(40000000)) return false;     // 40 MHz QSPI: default clock is slow
  ledcAttach(GFX_BL, 5000, 8);
  backlightSet(80);
  Wire.begin(TOUCH_SDA, TOUCH_SCL);
  Wire.setClock(400000);
  panelCanvas->fillScreen(RGB565_BLACK);
  panelCanvas->flush();
  return true;
}

void displaySetRotation(uint8_t r) {
  r &= 3;
  Arduino_Canvas *c = panelCanvas;
  if (r & 1) {
    if (!landCanvas) { landCanvas = new Arduino_Canvas(PHYS_H, PHYS_W, panel, 0, 0, 0); landCanvas->begin(GFX_SKIP_OUTPUT_BEGIN); }
    c = landCanvas;
  } else if (r == 2) {
    if (!flipCanvas) { flipCanvas = new Arduino_Canvas(PHYS_W, PHYS_H, panel, 0, 0, 0); flipCanvas->begin(GFX_SKIP_OUTPUT_BEGIN); }
    c = flipCanvas;
  }
  if (!c->getFramebuffer()) { c = panelCanvas; r = 0; }   // out of memory: stay portrait
  rot = r;
  SCR_W = (r & 1) ? PHYS_H : PHYS_W;
  SCR_H = (r & 1) ? PHYS_W : PHYS_H;
  gfx = c;
}

uint8_t displayRotation() { return rot; }

// Copy the logical surface onto the portrait panel (skill section 4: rotate in software).
void displayFlush() {
  if (rot == 0) { panelCanvas->flush(); return; }
  const uint16_t *src = gfx->getFramebuffer();
  uint16_t *dst = panelCanvas->getFramebuffer();
  for (int py = 0; py < PHYS_H; py++) {
    uint16_t *row = dst + py * PHYS_W;
    for (int px = 0; px < PHYS_W; px++) {
      int lx, ly;
      switch (rot) {
        case 1: lx = py; ly = PHYS_W - 1 - px; break;                  // turned left: logical 480x320
        case 3: lx = PHYS_H - 1 - py; ly = px; break;                  // turned right
        default: lx = PHYS_W - 1 - px; ly = PHYS_H - 1 - py; break;    // upside-down
      }
      row[px] = src[ly * SCR_W + lx];
    }
  }
  panelCanvas->flush();
}

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
  if (x >= PHYS_W || y >= PHYS_H) return false;
  int px = x, py = y;
  switch (rot) {   // inverse of the mapping in displayFlush()
    case 1: x = py; y = PHYS_W - 1 - px; break;
    case 3: x = PHYS_H - 1 - py; y = px; break;
    case 2: x = PHYS_W - 1 - px; y = PHYS_H - 1 - py; break;
    default: break;
  }
  return true;
}
