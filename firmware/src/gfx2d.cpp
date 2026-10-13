#include "gfx2d.h"
#include "display.h"
#include <LittleFS.h>
#include <math.h>

bool imgLoad(const char *path, Img565 &img) {
  imgFree(img);
  File f = LittleFS.open(path, "r");
  if (!f) return false;
  uint8_t hdr[8];
  if (f.read(hdr, 8) != 8 || hdr[0] != 'K' || hdr[1] != '5' || hdr[2] != 1) { f.close(); return false; }
  bool alpha = hdr[3] & 1;
  img.w = hdr[4] | (hdr[5] << 8);
  img.h = hdr[6] | (hdr[7] << 8);
  size_t n = (size_t)img.w * img.h;
  if (!n || img.w > SCR_W || img.h > SCR_H || f.size() < 8 + n * 2 + (alpha ? n : 0)) { f.close(); img.w = img.h = 0; return false; }
  img.px = (uint16_t *)ps_malloc(n * 2);
  if (alpha) img.a = (uint8_t *)ps_malloc(n);
  bool ok = img.px && (!alpha || img.a);
  if (ok) ok = f.read((uint8_t *)img.px, n * 2) == n * 2;
  if (ok && alpha) ok = f.read(img.a, n) == n;
  f.close();
  if (!ok) imgFree(img);
  return ok;
}

void imgFree(Img565 &img) {
  free(img.px); free(img.a);
  img.px = nullptr; img.a = nullptr; img.w = img.h = 0;
}

uint16_t blend565(uint16_t d, uint16_t s, uint8_t a) {
  if (a == 255) return s;
  if (a == 0) return d;
  uint32_t a5 = (a + 4) >> 3;   // 0..32
  uint32_t dd = (d | ((uint32_t)d << 16)) & 0x07E0F81F;
  uint32_t ss = (s | ((uint32_t)s << 16)) & 0x07E0F81F;
  uint32_t r = ((((ss - dd) * a5) >> 5) + dd) & 0x07E0F81F;
  return (uint16_t)(r | (r >> 16));
}

uint16_t scale565(uint16_t c, float k) {
  int r = ((c >> 11) & 0x1F) * k, g = ((c >> 5) & 0x3F) * k, b = (c & 0x1F) * k;
  return (min(r, 31) << 11) | (min(g, 63) << 5) | min(b, 31);
}

uint16_t hsv565(float h, float s, float v) {
  h = fmodf(h, 360.f); if (h < 0) h += 360.f;
  float c = v * s, x = c * (1 - fabsf(fmodf(h / 60.f, 2) - 1)), m = v - c, r, g, b;
  if (h < 60) { r = c; g = x; b = 0; } else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; } else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
  uint8_t R = (r + m) * 255, G = (g + m) * 255, B = (b + m) * 255;
  return ((R & 0xF8) << 8) | ((G & 0xFC) << 3) | (B >> 3);
}

// Signed distance from (px,py) to a rounded rect centred at (cx,cy) with half sizes (hw,hh).
static inline float sdRoundRect(float px, float py, float cx, float cy, float hw, float hh, float r) {
  float qx = fabsf(px - cx) - (hw - r), qy = fabsf(py - cy) - (hh - r);
  float ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0;
  float inside = qx > qy ? qx : qy;
  return sqrtf(ox * ox + oy * oy) + (inside < 0 ? inside : 0) - r;
}

template <typename F>
static void forBox(float x0, float y0, float x1, float y1, F fn) {
  int ix0 = max(0, (int)floorf(x0)), iy0 = max(0, (int)floorf(y0));
  int ix1 = min(SCR_W, (int)ceilf(x1)), iy1 = min(SCR_H, (int)ceilf(y1));
  for (int y = iy0; y < iy1; y++)
    for (int x = ix0; x < ix1; x++) fn(x, y);
}

void fillRoundRectAA(uint16_t *fb, float x, float y, float w, float h, float r, uint16_t c, float alpha) {
  r = min(r, min(w, h) / 2);
  float cx = x + w / 2, cy = y + h / 2;
  forBox(x, y, x + w, y + h, [&](int px, int py) {
    float d = sdRoundRect(px + .5f, py + .5f, cx, cy, w / 2, h / 2, r);
    if (d >= .5f) return;
    float a = (d <= -.5f ? 1.f : .5f - d) * alpha;
    uint16_t &p = fb[py * SCR_W + px];
    p = blend565(p, c, (uint8_t)(a * 255));
  });
}

void glowRoundRect(uint16_t *fb, float x, float y, float w, float h, float r, float spread, uint16_t c, float alpha) {
  if (alpha <= 0.01f) return;
  r = min(r, min(w, h) / 2);
  float cx = x + w / 2, cy = y + h / 2;
  forBox(x - spread, y - spread, x + w + spread, y + h + spread, [&](int px, int py) {
    float d = sdRoundRect(px + .5f, py + .5f, cx, cy, w / 2, h / 2, r);
    if (d <= 0 || d >= spread) return;
    float t = 1.f - d / spread;
    uint16_t &p = fb[py * SCR_W + px];
    p = blend565(p, c, (uint8_t)(alpha * t * t * 255));
  });
}

void outlineRoundRect(uint16_t *fb, float x, float y, float w, float h, float r, float thick, uint16_t c, float alpha) {
  if (alpha <= 0.01f) return;
  r = min(r, min(w, h) / 2);
  float cx = x + w / 2, cy = y + h / 2;
  forBox(x - 1, y - 1, x + w + 1, y + h + 1, [&](int px, int py) {
    float d = sdRoundRect(px + .5f, py + .5f, cx, cy, w / 2, h / 2, r);
    float e = fabsf(d + thick / 2) - thick / 2;    // band just inside the edge
    if (e >= .5f) return;
    float a = (e <= -.5f ? 1.f : .5f - e) * alpha;
    uint16_t &p = fb[py * SCR_W + px];
    p = blend565(p, c, (uint8_t)(a * 255));
  });
}

void ringAA(uint16_t *fb, float cx, float cy, float radius, float thick, uint16_t c, float alpha) {
  if (alpha <= 0.01f) return;
  float o = radius + thick;
  forBox(cx - o, cy - o, cx + o, cy + o, [&](int px, int py) {
    float dx = px + .5f - cx, dy = py + .5f - cy;
    float e = fabsf(sqrtf(dx * dx + dy * dy) - radius) - thick / 2;
    if (e >= .5f) return;
    float a = (e <= -.5f ? 1.f : .5f - e) * alpha;
    uint16_t &p = fb[py * SCR_W + px];
    p = blend565(p, c, (uint8_t)(a * 255));
  });
}

void fillRectBlend(uint16_t *fb, int x, int y, int w, int h, uint16_t c, uint8_t a) {
  int x0 = max(0, x), y0 = max(0, y), x1 = min(SCR_W, x + w), y1 = min(SCR_H, y + h);
  for (int py = y0; py < y1; py++)
    for (int px = x0; px < x1; px++) fb[py * SCR_W + px] = blend565(fb[py * SCR_W + px], c, a);
}

void verticalGradient(uint16_t *fb, int y0, int h, uint16_t top, uint16_t bottom) {
  for (int y = 0; y < h; y++) {
    uint16_t c = blend565(top, bottom, (uint8_t)(y * 255 / max(1, h - 1)));
    uint16_t *row = fb + (y0 + y) * SCR_W;
    for (int x = 0; x < SCR_W; x++) row[x] = c;
  }
}

void blitScaled(uint16_t *fb, const Img565 &img, float x, float y, float w, float h, float k) {
  if (!img.px || w < 1 || h < 1) return;
  int ix0 = max(0, (int)x), iy0 = max(0, (int)y);
  int ix1 = min(SCR_W, (int)(x + w)), iy1 = min(SCR_H, (int)(y + h));
  float sx = img.w / w, sy = img.h / h;
  bool dim = k < 0.995f;
  for (int py = iy0; py < iy1; py++) {
    int srcY = min((int)((py - y) * sy), img.h - 1);
    const uint16_t *srow = img.px + srcY * img.w;
    const uint8_t *arow = img.a ? img.a + srcY * img.w : nullptr;
    uint16_t *drow = fb + py * SCR_W;
    for (int px = ix0; px < ix1; px++) {
      int srcX = min((int)((px - x) * sx), img.w - 1);
      uint8_t a = arow ? arow[srcX] : 255;
      if (!a) continue;
      uint16_t s = srow[srcX];
      if (dim) s = scale565(s, k);
      drow[px] = blend565(drow[px], s, a);
    }
  }
}
