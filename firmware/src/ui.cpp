#include "ui.h"
#include "config.h"
#include "display.h"
#include "gfx2d.h"
#include "hid_out.h"
#include "macro.h"
#include "proto.h"
#include <math.h>

// Responsiveness design:
// - Touch runs on its own task every 5 ms and fires the macro immediately, so typing never waits
//   for a screen redraw.
// - The screen keeps a cached "base" frame (background + keys at rest + bars). An animation frame
//   copies the base and redraws only the keys that move; glows only tint background pixels.

struct KeyAnim {
  uint32_t pressT = 0, releaseT = 0;
  bool down = false;
  float atRelease = 0;      // press amount when released
  int16_t rx = 0, ry = 0;   // ripple origin
};

enum : uint8_t { EV_PRESS, EV_RELEASE, EV_WAKE, EV_NAV, EV_INFO };
struct TouchEv { uint8_t type; int8_t dir; int16_t key, x, y, page; uint32_t t; };

static SemaphoreHandle_t lock;          // guards cfg / page while the touch task hit-tests
static QueueHandle_t touchQ;
static int page = 0;
static uint16_t *bgBuf;                 // current page background (PSRAM)
static uint16_t *baseBuf;               // background + keys at rest + bars (PSRAM)
static std::vector<Img565> caps;        // keycap images for the current page
static std::vector<KeyAnim> anims;
static bool baseDirty = true, needFrame = true;
static uint32_t lastFrame = 0;
static volatile uint32_t lastTouch = 0;
static volatile bool dimmed = false;
static int brightPreview = -1;
static String toast;
static uint32_t toastUntil = 0;
static Link lastLink = LINK_NONE;
static BleState lastBle = BLE_OFF;
static float frameMsAvg = 0;

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

// ms since the last touch. lastTouch is written by the touch task, so it can be a few ms newer than
// `now` taken by the UI loop; a plain `now - lastTouch` then wraps to ~49 days and the keypad thought
// it was idle, dimmed itself and swallowed the next tap as a wake-up (keys did nothing, 1.1.0-1.3.2).
static uint32_t sinceTouch(uint32_t now) {
  int32_t d = (int32_t)(now - lastTouch);
  return d > 0 ? (uint32_t)d : 0;
}

static bool idleActive(uint32_t now) {
  return cfg.idle != ID_NONE && !dimmed && sinceTouch(now) > cfg.idleAfter * 1000UL;
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
  baseDirty = true;
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

// Keycap body only (no effects) at the given geometry.
static void drawCap(uint16_t *fb, size_t i, float x, float y, float w, float h, float r, float dimK) {
  const KeyDef &k = cfg.pages[page].keys[i];
  if (caps[i].px) {
    blitScaled(fb, caps[i], x, y, w, h, dimK);
  } else {
    fillRoundRectAA(fb, x, y, w, h, r, scale565(k.color, dimK));
    fillRoundRectAA(fb, x + 2, y + 2, w - 4, h * .45f, max(0.f, r - 2), RGB565_WHITE, .08f);   // subtle top sheen
    drawLabel(k, x, y, w, h, k.textColor);
  }
}

// Redraws an animating key over the base frame.
static void drawAnimatedKey(uint16_t *fb, size_t i, uint32_t now) {
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

  bool moved = fabsf(scale - 1) > .002f || dy > .2f || dimK < .995f;
  if (moved) {
    copyRect(fb, bgBuf, k.x, k.y, k.w, k.h + 6);      // erase the resting key
    drawCap(fb, i, x, y, w, h, r, dimK);
  }
  if (k.light == LI_GLOW) glowRoundRect(fb, x, y, w, h, r, 16, k.fxColor, amt, bgBuf);
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
  gfx->setTextSize(1);                      // small firmware version after the page name
  gfx->setTextColor(0x8C71);
  gfx->setCursor(6 + t.length() * 12 + 6, 10);
  gfx->print("v" FW_VERSION);
  gfx->setTextSize(2);
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

// Background + every key at rest + bars, rendered into the canvas then saved as the base frame.
static void buildBase() {
  uint16_t *fb = displayFb();
  memcpy(fb, bgBuf, SCR_W * SCR_H * 2);
  const PageDef &p = cfg.pages[page];
  for (size_t i = 0; i < p.keys.size(); i++) {
    const KeyDef &k = p.keys[i];
    drawCap(fb, i, k.x, k.y, k.w, k.h, k.r, 1);
  }
  drawStatus(fb);
  drawNav(fb);
  memcpy(baseBuf, fb, SCR_W * SCR_H * 2);
  baseDirty = false;
}

static void renderFrame(uint32_t now) {
  uint32_t t0 = millis();
  if (baseDirty) buildBase();
  uint16_t *fb = displayFb();
  memcpy(fb, baseBuf, SCR_W * SCR_H * 2);

  const PageDef &p = cfg.pages[page];
  if (idleActive(now)) {
    float period = 6000.f - cfg.idleSpeed * 50.f;   // ms
    float ph = now / period;
    for (size_t i = 0; i < p.keys.size(); i++) {
      const KeyDef &k = p.keys[i];
      float g = 0; uint16_t c = cfg.idleColor;
      switch (cfg.idle) {
        case ID_BREATHE: g = .15f + .45f * (.5f + .5f * sinf(2 * PI * ph)); break;
        case ID_RAINBOW: g = .55f; c = hsv565(ph * 360 + i * 28, 1, 1); break;
        case ID_WAVE: g = .6f * powf(.5f + .5f * sinf(2 * PI * ph - (k.x + k.y) / 90.f), 2); break;
        default: break;
      }
      glowRoundRect(fb, k.x, k.y, k.w, k.h, k.r, 12, c, g, bgBuf);
    }
  }
  for (size_t i = 0; i < p.keys.size(); i++)
    if (keyAnimating(p.keys[i], anims[i], now)) drawAnimatedKey(fb, i, now);
  drawToast(fb, now);
  displayFlush();
  frameMsAvg = frameMsAvg * .9f + (millis() - t0) * .1f;
}

// ---------- input ----------
static void applyBrightness() {
  backlightSet(brightPreview >= 0 ? brightPreview : (dimmed ? cfg.dimLevel : cfg.brightness));
}

// Runs on the touch task: hit-test and fire the macro right away, then tell the UI loop.
static void touchPressed(int x, int y, uint32_t now) {
  TouchEv ev = {EV_PRESS, 0, -1, (int16_t)x, (int16_t)y, 0, now};
  xSemaphoreTake(lock, portMAX_DELAY);
  if (dimmed) {
    ev.type = EV_WAKE;
  } else if (navVisible() && y >= SCR_H - NAV_H) {
    if (x < 90) { ev.type = EV_NAV; ev.dir = -1; }
    else if (x > SCR_W - 90) { ev.type = EV_NAV; ev.dir = 1; }
    else ev.type = 0xFF;
  } else {
    const PageDef &p = cfg.pages[page];
    ev.page = page;
    for (int i = (int)p.keys.size() - 1; i >= 0; i--) {    // topmost key wins
      const KeyDef &k = p.keys[i];
      if (x < k.x || x >= k.x + k.w || y < k.y || y >= k.y + k.h) continue;
      ev.key = i;
      macroRun(k.actions);
      break;
    }
    if (ev.key < 0) ev.type = 0xFF;
  }
  xSemaphoreGive(lock);
  if (ev.type != 0xFF) xQueueSend(touchQ, &ev, 0);
}

// Touch: act on press; release after >= 6 consecutive empty reads (the controller drops out while held).
// Holding the top status bar for 1.5 s shows the firmware version.
static void touchTask(void *) {
  bool down = false, infoSent = false;
  int empty = 0, downY = 0;
  uint32_t downT = 0;
  for (;;) {
    int x, y;
    uint32_t now = millis();
    if (touchRead(x, y)) {
      empty = 0;
      lastTouch = now;
      if (!down) { down = true; infoSent = false; downT = now; downY = y; touchPressed(x, y, now); }
      else if (!infoSent && downY < STATUS_H + 8 && y < STATUS_H + 30 && now - downT >= 1500) {
        infoSent = true;
        TouchEv ev = {EV_INFO, 0, -1, 0, 0, 0, now};
        xQueueSend(touchQ, &ev, 0);
      }
    } else if (down && ++empty >= 6) {
      down = false;
      TouchEv ev = {EV_RELEASE, 0, -1, 0, 0, 0, now};
      xQueueSend(touchQ, &ev, 0);
    }
    vTaskDelay(pdMS_TO_TICKS(5));
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

static void handleTouchEvents() {
  TouchEv ev;
  while (xQueueReceive(touchQ, &ev, 0) == pdTRUE) {
    ev.t = millis();   // UI-loop clock, so animation maths never sees a timestamp from its future
    switch (ev.type) {
      case EV_WAKE: dimmed = false; applyBrightness(); needFrame = true; break;
      case EV_NAV: uiSetPage((page + cfg.pages.size() + ev.dir) % cfg.pages.size()); break;
      case EV_RELEASE: releaseAll(ev.t); break;
      case EV_INFO: {
        static String info;
        Link l = hidLink();
        info = String("v") + FW_VERSION + (l == LINK_USB ? " USB" : l == LINK_BLE ? " BLE" : "");
        uiMessage(info.c_str());
        break;
      }
      case EV_PRESS: {
        if (ev.page != page || ev.key < 0 || ev.key >= (int)anims.size()) break;
        KeyAnim &a = anims[ev.key];
        a.pressT = ev.t; a.down = true; a.rx = ev.x; a.ry = ev.y;
        char js[64];
        snprintf(js, sizeof(js), "{\"ev\":\"press\",\"p\":%d,\"k\":%d}", page, ev.key);
        protoEvent(js);
        break;
      }
    }
  }
}

// ---------- public ----------
void uiBegin() {
  bgBuf = (uint16_t *)ps_malloc(SCR_W * SCR_H * 2);
  baseBuf = (uint16_t *)ps_malloc(SCR_W * SCR_H * 2);
  lock = xSemaphoreCreateMutex();
  touchQ = xQueueCreate(16, sizeof(TouchEv));
  lastTouch = millis();
  uiReload();
  xTaskCreatePinnedToCore(touchTask, "touch", 4096, nullptr, 3, nullptr, 1);
}

void uiApplyConfig(const Config &c) {
  if (lock) xSemaphoreTake(lock, portMAX_DELAY);
  cfg = c;
  if (lock) xSemaphoreGive(lock);
  uiReload();
}

void uiReload() {
  if (lock) xSemaphoreTake(lock, portMAX_DELAY);
  displaySetRotation(cfg.rotation);   // orientation chosen in the studio
  if (page >= (int)cfg.pages.size()) page = 0;
  loadPageAssets();
  if (lock) xSemaphoreGive(lock);
  dimmed = false;
  applyBrightness();
  needFrame = true;
}

void uiSetPage(int p) {
  if (p < 0 || p >= (int)cfg.pages.size() || p == page) return;
  xSemaphoreTake(lock, portMAX_DELAY);
  page = p;
  loadPageAssets();
  xSemaphoreGive(lock);
  needFrame = true;
  char ev[40];
  snprintf(ev, sizeof(ev), "{\"ev\":\"page\",\"p\":%d}", page);
  protoEvent(ev);
}

int uiPage() { return page; }
float uiFrameMs() { return frameMsAvg; }

void uiBrightnessPreview(int percent) { brightPreview = percent; applyBrightness(); }

void uiMessage(const char *msg) { toast = msg; toastUntil = millis() + 1500; needFrame = true; }

void uiLoop() {
  handleTouchEvents();
  uint32_t now = millis();

  if (!dimmed && cfg.dimAfter && sinceTouch(now) > cfg.dimAfter * 1000UL) { dimmed = true; applyBrightness(); needFrame = true; }
  Link l = hidLink(); BleState b = hidBleState();
  if (l != lastLink || b != lastBle) { lastLink = l; lastBle = b; baseDirty = true; }

  bool anim = false;
  const PageDef &p = cfg.pages[page];
  for (size_t i = 0; i < p.keys.size() && !anim; i++) anim = keyAnimating(p.keys[i], anims[i], now);
  bool idle = idleActive(now);
  static bool wasIdle = false;
  if (wasIdle && !idle) needFrame = true;     // clear the idle glow
  wasIdle = idle;
  bool toastOn = now <= toastUntil + 40;

  // Flush only when something changed: ~30 ms between frames while animating, ~60 ms for idle ambience.
  uint32_t minGap = (anim || needFrame || baseDirty) ? 25 : 60;
  if ((needFrame || baseDirty || anim || idle || toastOn) && now - lastFrame >= minGap) {
    renderFrame(now);
    lastFrame = now;
    needFrame = anim || toastOn;   // one more frame after the animation settles
  }
}
