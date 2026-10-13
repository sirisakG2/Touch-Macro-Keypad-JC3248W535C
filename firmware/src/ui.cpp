#include "ui.h"
#include "config.h"
#include "display.h"
#include "gfx2d.h"
#include "hid_out.h"
#include "macro.h"
#include "proto.h"
#include <math.h>

struct KeyAnim {
  uint32_t pressT = 0, releaseT = 0;
  bool down = false;
  float atRelease = 0;      // press amount when released
  int16_t rx = 0, ry = 0;   // ripple origin
};

static int page = 0;
static uint16_t *bgBuf;                 // current page background (PSRAM)
static std::vector<Img565> caps;        // keycap images for the current page
static std::vector<KeyAnim> anims;
static bool dirty = true;
static uint32_t lastFrame = 0, lastTouch = 0;
static bool dimmed = false;
static int brightPreview = -1;
static String toast;
static uint32_t toastUntil = 0;
static Link lastLink = LINK_NONE;
static BleState lastBle = BLE_OFF;

// ---------- easing / animation ----------
static inline float clamp01(float v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
static inline float easeOut(float t) { t = clamp01(t); return 1 - (1 - t) * (1 - t) * (1 - t); }

// Press amount 0..1: rises over 35% of fxMs while held, falls over 65% after release.
static float pressAmount(const KeyDef &k, const KeyAnim &a, uint32_t now) {
  if (!a.pressT) return 0;
  float in = max(40.f, k.fxMs * .35f), out = max(60.f, k.fxMs * .65f);
  if (a.down) return easeOut((now - a.pressT) / in);
  return a.atRelease * (1 - easeOut((now - a.releaseT) / out));
}

static bool keyAnimating(const KeyDef &k, const KeyAnim &a, uint32_t now) {
  if (!a.pressT) return false;
  if (a.down) return true;
  uint32_t outMs = max(60, (int)(k.fxMs * .65f)) + (k.motion == MO_BOUNCE ? k.fxMs / 2 : 0);
  if (now - a.releaseT < outMs) return true;
  return k.light == LI_RIPPLE && now - a.pressT < (uint32_t)k.fxMs * 2;
}

// ---------- assets ----------
static void loadPageAssets() {
  for (auto &c : caps) imgFree(c);
  const PageDef &p = cfg.pages[page];
  caps.assign(p.keys.size(), Img565());
  anims.assign(p.keys.size(), KeyAnim());
  for (size_t i = 0; i < p.keys.size(); i++)
    if (p.keys[i].img.length()) imgLoad(("/" + p.keys[i].img).c_str(), caps[i]);

  Img565 bg;
  if (p.bgImg.length() && imgLoad(("/" + p.bgImg).c_str(), bg) && bg.w == SCR_W && bg.h == SCR_H) {
    memcpy(bgBuf, bg.px, SCR_W * SCR_H * 2);
  } else if (p.gradient) {
    verticalGradient(bgBuf, 0, SCR_H, p.bg, p.bg2);
  } else {
    for (int i = 0; i < SCR_W * SCR_H; i++) bgBuf[i] = p.bg;
  }
  imgFree(bg);
  dirty = true;
}

// ---------- drawing ----------
static void drawLabel(const KeyDef &k, float x, float y, float w, float h, uint16_t color) {
  if (!k.label.length()) return;
  int fs = k.fontSize;
  int tw = k.label.length() * 6 * fs, th = 8 * fs;
  while (fs > 1 && tw > w - 6) { fs--; tw = k.label.length() * 6 * fs; th = 8 * fs; }
  gfx->setTextSize(fs);
  gfx->setTextColor(color);
  gfx->setCursor((int)(x + (w - tw) / 2 + fs / 2), (int)(y + (h - th) / 2));
  gfx->print(k.label);
}

static void drawKey(uint16_t *fb, size_t i, uint32_t now, float idleGlow, uint16_t idleColor) {
  const KeyDef &k = cfg.pages[page].keys[i];
  const KeyAnim &a = anims[i];
  float amt = pressAmount(k, a, now);
  float scale = 1, dy = 0, dimK = 1;
  switch (k.motion) {
    case MO_PUSH: scale = 1 - .08f * amt; break;
    case MO_POP: scale = 1 + .06f * amt; break;
    case MO_SINK: dy = 5 * amt; dimK = 1 - .25f * amt; break;
    case MO_BOUNCE: {
      scale = 1 - .10f * amt;
      if (!a.down && a.pressT) {
        float s = clamp01((now - a.releaseT) / (float)max<uint16_t>(k.fxMs, 60));
        scale += .07f * sinf(PI * s * 2) * (1 - s) * a.atRelease;
      }
      break;
    }
    default: break;
  }
  float w = k.w * scale, h = k.h * scale;
  float x = k.x + (k.w - w) / 2, y = k.y + (k.h - h) / 2 + dy;
  float r = k.r * scale;

  if (idleGlow > 0) glowRoundRect(fb, x, y, w, h, r, 12, idleColor, idleGlow);
  if (k.light == LI_GLOW) glowRoundRect(fb, x, y, w, h, r, 16, k.fxColor, amt);

  if (caps[i].px) {
    blitScaled(fb, caps[i], x, y, w, h, dimK);
  } else {
    fillRoundRectAA(fb, x, y, w, h, r, scale565(k.color, dimK));
    fillRoundRectAA(fb, x + 2, y + 2, w - 4, h * .45f, max(0.f, r - 2), RGB565_WHITE, .08f);   // subtle top sheen
    drawLabel(k, x, y, w, h, k.textColor);
  }

  if (k.light == LI_FLASH) fillRoundRectAA(fb, x, y, w, h, r, k.fxColor, .55f * amt);
  if (k.light == LI_OUTLINE) outlineRoundRect(fb, x - 1, y - 1, w + 2, h + 2, r + 1, 3, k.fxColor, amt);
  if (k.light == LI_RIPPLE && a.pressT) {
    float t = (now - a.pressT) / (float)(k.fxMs * 2);
    if (t < 1) ringAA(fb, a.rx, a.ry, 8 + t * max(k.w, k.h) * 0.9f, 3 + 3 * (1 - t), k.fxColor, (1 - t) * .9f);
  }
}

static void drawStatus(uint16_t *fb) {
  if (!cfg.statusBar) return;
  fillRectBlend(fb, 0, 0, SCR_W, STATUS_H, RGB565_BLACK, 150);
  gfx->setTextSize(2);
  gfx->setTextColor(RGB565_WHITE);
  gfx->setCursor(6, 3);
  String t = cfg.pages[page].name;
  if (t.length() > 14) t = t.substring(0, 14);
  gfx->print(t);
  const char *ls; uint16_t lc;
  Link l = hidLink();
  if (l == LINK_USB) { ls = "USB"; lc = 0x07E0; }
  else if (l == LINK_BLE) { ls = "BLE"; lc = 0x34DF; }
  else if (hidBleState() == BLE_ADV) { ls = "BLE..."; lc = 0x8410; }
  else { ls = "---"; lc = 0x8410; }
  gfx->setTextColor(lc);
  gfx->setCursor(SCR_W - 6 - strlen(ls) * 12, 3);
  gfx->print(ls);
}

static bool navVisible() { return cfg.pages.size() > 1; }

static void drawNav(uint16_t *fb) {
  if (!navVisible()) return;
  int y = SCR_H - NAV_H;
  fillRectBlend(fb, 0, y, SCR_W, NAV_H, RGB565_BLACK, 150);
  fillRoundRectAA(fb, 6, y + 5, 70, NAV_H - 10, 10, 0x4208);
  fillRoundRectAA(fb, SCR_W - 76, y + 5, 70, NAV_H - 10, 10, 0x4208);
  gfx->setTextSize(3);
  gfx->setTextColor(RGB565_WHITE);
  gfx->setCursor(32, y + 11); gfx->print("<");
  gfx->setCursor(SCR_W - 50, y + 11); gfx->print(">");
  int n = cfg.pages.size(), gap = min(18, 150 / max(1, n));
  int x0 = SCR_W / 2 - (n - 1) * gap / 2;
  for (int i = 0; i < n; i++)
    fillRoundRectAA(fb, x0 + i * gap - 4, y + NAV_H / 2 - 4, 8, 8, 4, i == page ? RGB565_WHITE : 0x6B4D);
}

static void drawToast(uint16_t *fb, uint32_t now) {
  if (now > toastUntil) return;
  int w = toast.length() * 12 + 24, x = (SCR_W - w) / 2, y = SCR_H - NAV_H - 50;
  fillRoundRectAA(fb, x, y, w, 34, 12, RGB565_BLACK, .8f);
  gfx->setTextSize(2);
  gfx->setTextColor(RGB565_WHITE);
  gfx->setCursor(x + 12, y + 9);
  gfx->print(toast);
}

static void renderFrame(uint32_t now) {
  uint16_t *fb = displayFb();
  memcpy(fb, bgBuf, SCR_W * SCR_H * 2);

  bool idle = cfg.idle != ID_NONE && !dimmed && now - lastTouch > cfg.idleAfter * 1000UL;
  float period = 6000.f - cfg.idleSpeed * 50.f;   // ms
  float ph = now / period;
  const PageDef &p = cfg.pages[page];
  for (size_t i = 0; i < p.keys.size(); i++) {
    float g = 0; uint16_t c = cfg.idleColor;
    if (idle) {
      const KeyDef &k = p.keys[i];
      switch (cfg.idle) {
        case ID_BREATHE: g = .15f + .45f * (.5f + .5f * sinf(2 * PI * ph)); break;
        case ID_RAINBOW: g = .55f; c = hsv565(ph * 360 + i * 28, 1, 1); break;
        case ID_WAVE: g = .6f * powf(.5f + .5f * sinf(2 * PI * ph - (k.x + k.y) / 90.f), 2); break;
        default: break;
      }
    }
    drawKey(fb, i, now, g, c);
  }
  drawStatus(fb);
  drawNav(fb);
  drawToast(fb, now);
  displayFlush();
}

// ---------- input ----------
static void applyBrightness() {
  backlightSet(brightPreview >= 0 ? brightPreview : (dimmed ? cfg.dimLevel : cfg.brightness));
}

static void onPress(int x, int y, uint32_t now) {
  if (dimmed) { dimmed = false; applyBrightness(); dirty = true; return; }   // wake touch does nothing else
  if (navVisible() && y >= SCR_H - NAV_H) {
    if (x < 90) uiSetPage((page + cfg.pages.size() - 1) % cfg.pages.size());
    else if (x > SCR_W - 90) uiSetPage((page + 1) % cfg.pages.size());
    return;
  }
  const PageDef &p = cfg.pages[page];
  for (int i = (int)p.keys.size() - 1; i >= 0; i--) {    // topmost key wins
    const KeyDef &k = p.keys[i];
    if (x < k.x || x >= k.x + k.w || y < k.y || y >= k.y + k.h) continue;
    KeyAnim &a = anims[i];
    a.pressT = now; a.down = true; a.rx = x; a.ry = y;
    macroRun(k.actions);
    char ev[64];
    snprintf(ev, sizeof(ev), "{\"ev\":\"press\",\"p\":%d,\"k\":%d}", page, i);
    protoEvent(ev);
    return;
  }
}

static void releaseAll(uint32_t now) {
  const PageDef &p = cfg.pages[page];
  for (size_t i = 0; i < anims.size(); i++) {
    KeyAnim &a = anims[i];
    if (!a.down) continue;
    a.atRelease = pressAmount(p.keys[i], a, now);
    a.down = false;
    a.releaseT = now;
  }
}

// Touch: act on press; release after >= 6 consecutive empty reads (the controller drops out while held).
static void pollTouch(uint32_t now) {
  static bool down = false;
  static int empty = 0;
  int x, y;
  if (touchRead(x, y)) {
    empty = 0;
    lastTouch = now;
    if (!down) { down = true; onPress(x, y, now); }
  } else if (down && ++empty >= 6) {
    down = false;
    releaseAll(now);
  }
}

// ---------- public ----------
void uiBegin() {
  bgBuf = (uint16_t *)ps_malloc(SCR_W * SCR_H * 2);
  lastTouch = millis();
  uiReload();
}

void uiReload() {
  if (page >= (int)cfg.pages.size()) page = 0;
  loadPageAssets();
  dimmed = false;
  applyBrightness();
}

void uiSetPage(int p) {
  if (p < 0 || p >= (int)cfg.pages.size() || p == page) return;
  page = p;
  loadPageAssets();
  char ev[40];
  snprintf(ev, sizeof(ev), "{\"ev\":\"page\",\"p\":%d}", page);
  protoEvent(ev);
}

int uiPage() { return page; }

void uiBrightnessPreview(int percent) { brightPreview = percent; applyBrightness(); }

void uiMessage(const char *msg) { toast = msg; toastUntil = millis() + 1500; dirty = true; }

void uiLoop() {
  uint32_t now = millis();
  pollTouch(now);

  if (!dimmed && cfg.dimAfter && now - lastTouch > cfg.dimAfter * 1000UL) { dimmed = true; applyBrightness(); dirty = true; }
  Link l = hidLink(); BleState b = hidBleState();
  if (l != lastLink || b != lastBle) { lastLink = l; lastBle = b; dirty = true; }

  bool anim = false;
  const PageDef &p = cfg.pages[page];
  for (size_t i = 0; i < p.keys.size() && !anim; i++) anim = keyAnimating(p.keys[i], anims[i], now);
  bool idle = cfg.idle != ID_NONE && !dimmed && now - lastTouch > cfg.idleAfter * 1000UL;
  bool toastOn = now <= toastUntil + 40;

  // Flush only when something changed, at most every ~30 ms (40 ms while only idling).
  uint32_t minGap = (anim || dirty) ? 30 : 45;
  if ((dirty || anim || idle || toastOn) && now - lastFrame >= minGap) {
    renderFrame(now);
    lastFrame = now;
    dirty = anim || toastOn;   // one more frame after the animation settles
  }
}
