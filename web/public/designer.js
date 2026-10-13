// Renders keycaps and page backgrounds exactly as the keypad will show them, packs them into the
// firmware's .565 image format, and compiles the editable project into the device config.
import { SCREEN, setOrientation } from './schema.js';
import { loadIcons, iconDataUrl } from './icons.js';

export const STYLES = ['flat', '3d', 'glass', 'outline', 'neon', 'image'];
export const FONTS = ['system-ui', 'Arial', 'Georgia', 'Courier New', 'Impact', 'Trebuchet MS', 'Verdana', 'monospace'];

const imgCache = new Map();
export function loadImage(src) {
  if (!src) return Promise.resolve(null);
  if (!imgCache.has(src)) {
    imgCache.set(src, new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    }));
  }
  return imgCache.get(src);
}

export function hexToRgb(hex) {
  const v = parseInt((hex || '#000000').slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function shade(hex, k) {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.max(0, Math.min(255, Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k)))));
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawCover(ctx, im, x, y, w, h, fit = 'cover') {
  const s = fit === 'contain' ? Math.min(w / im.width, h / im.height) : Math.max(w / im.width, h / im.height);
  const dw = im.width * s, dh = im.height * s;
  ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// Draws one keycap at (0,0) size w x h on ctx. Transparent outside the rounded shape.
// mosaic: optional 320x480 canvas with the page's "picture across keys"; a key without its own
// picture shows its slice (key.x, key.y, key.w, key.h) of it.
export async function drawCap(ctx, key, mosaic = null) {
  const { w, h } = key;
  const r = key.r ?? 14;
  const c = key.color || '#2f6fed';
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  const style = key.style || 'flat';
  if (style === 'flat') {
    roundRect(ctx, 0, 0, w, h, r); ctx.fillStyle = c; ctx.fill();
  } else if (style === '3d') {
    roundRect(ctx, 0, 0, w, h, r); ctx.fillStyle = shade(c, -0.45); ctx.fill();
    const g = ctx.createLinearGradient(0, 0, 0, h - 6);
    g.addColorStop(0, shade(c, 0.25)); g.addColorStop(1, shade(c, -0.1));
    roundRect(ctx, 2, 1, w - 4, h - 7, r - 1); ctx.fillStyle = g; ctx.fill();
  } else if (style === 'glass') {
    roundRect(ctx, 0, 0, w, h, r);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, shade(c, 0.35)); g.addColorStop(1, shade(c, -0.35));
    ctx.fillStyle = g; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
    roundRect(ctx, 3, 3, w - 6, h * 0.45, r - 2);
    const hl = ctx.createLinearGradient(0, 0, 0, h * 0.45);
    hl.addColorStop(0, 'rgba(255,255,255,0.45)'); hl.addColorStop(1, 'rgba(255,255,255,0.03)');
    ctx.fillStyle = hl; ctx.fill();
    roundRect(ctx, 0.75, 0.75, w - 1.5, h - 1.5, r); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
  } else if (style === 'outline') {
    roundRect(ctx, 0, 0, w, h, r); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
    roundRect(ctx, 1.5, 1.5, w - 3, h - 3, r); ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.stroke();
  } else if (style === 'neon') {
    roundRect(ctx, 0, 0, w, h, r); ctx.fillStyle = '#05060a'; ctx.fill();
    ctx.shadowColor = c; ctx.shadowBlur = 10;
    roundRect(ctx, 4, 4, w - 8, h - 8, r - 3); ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.stroke();
    ctx.shadowBlur = 0;
  } else if (style === 'image') {
    roundRect(ctx, 0, 0, w, h, r); ctx.fillStyle = c; ctx.fill();
  }
  const slice = mosaic && !key.image;
  if (slice) {
    ctx.save();
    roundRect(ctx, 0, 0, w, h, r); ctx.clip();
    ctx.drawImage(mosaic, key.x, key.y, w, h, 0, 0, w, h);
    // keep a hint of the chosen keycap style on top of the picture
    if (style === '3d') {
      const g = ctx.createLinearGradient(0, h * 0.55, 0, h);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    } else if (style === 'glass') {
      const hl = ctx.createLinearGradient(0, 0, 0, h * 0.45);
      hl.addColorStop(0, 'rgba(255,255,255,0.4)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
      roundRect(ctx, 3, 3, w - 6, h * 0.45, r - 2); ctx.fillStyle = hl; ctx.fill();
    }
    ctx.restore();
    if (style === 'glass') { roundRect(ctx, 0.75, 0.75, w - 1.5, h - 1.5, r); ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    if (style === 'outline' || style === 'neon') { roundRect(ctx, 1.5, 1.5, w - 3, h - 3, r); ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.stroke(); }
  }
  if (key.image) {
    const im = await loadImage(key.image);
    if (im) {
      ctx.save();
      roundRect(ctx, 0, 0, w, h, r); ctx.clip();
      if (key.imageFit === 'icon') drawCover(ctx, im, w * 0.2, h * 0.12, w * 0.6, h * (key.label ? 0.5 : 0.76), 'contain');
      else drawCover(ctx, im, 0, 0, w, h, key.imageFit || 'cover');
      ctx.restore();
    }
  }
  // Icon (Lucide) + label. iconPos: 'above' (default), 'left' (icon then text), 'only' (icon, no text).
  const alpha = Math.max(0, Math.min(100, key.textOpacity ?? 100)) / 100;   // label/icon transparency
  let iconImg = null, iconPx = 0;
  if (key.icon?.name) {
    await loadIcons();
    iconImg = await loadImage(iconDataUrl(key.icon.name, key.icon.color || key.text || '#ffffff', 2));
    iconPx = Math.round(Math.min(w, h) * (key.icon.size || 45) / 100);
  }
  const iconPos = iconImg ? (key.iconPos || 'above') : null;
  const showText = key.label && iconPos !== 'only';
  const px = key.fontPx || 20;
  ctx.font = `${key.fontWeight || 700} ${px}px ${key.font || 'system-ui'}`;
  ctx.fillStyle = key.text || '#ffffff';
  ctx.globalAlpha = alpha;
  ctx.textBaseline = 'middle';
  if (style === 'neon') { ctx.shadowColor = key.text || c; ctx.shadowBlur = 8; }
  else if (key.image || slice) { ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4; }
  const lines = showText ? String(key.label).split('\n') : [];
  const lh = px * 1.15;
  if (iconPos === 'left' && lines.length) {
    const text = lines.join(' ');
    const tw = Math.min(ctx.measureText(text).width, w - iconPx - 14);
    const x0 = (w - (iconPx + 6 + tw)) / 2;
    ctx.drawImage(iconImg, x0, (h - iconPx) / 2, iconPx, iconPx);
    ctx.textAlign = 'left';
    ctx.fillText(text, x0 + iconPx + 6, h / 2, w - iconPx - 14);
  } else if (iconPos) {
    const textH = lines.length ? 4 + lh * lines.length : 0;
    const top = (h - iconPx - textH) / 2;
    ctx.drawImage(iconImg, (w - iconPx) / 2, top, iconPx, iconPx);
    ctx.textAlign = 'center';
    lines.forEach((ln, i) => ctx.fillText(ln, w / 2, top + iconPx + 4 + lh * (i + 0.5), w - 8));
  } else if (lines.length) {
    ctx.textAlign = 'center';
    const pos = key.labelPos || (key.image && key.imageFit === 'icon' ? 'bottom' : 'center');
    const y0 = pos === 'bottom' ? h - 8 - lh * (lines.length - 0.5) : pos === 'top' ? 8 + lh / 2 : h / 2 - (lh * (lines.length - 1)) / 2;
    lines.forEach((ln, i) => ctx.fillText(ln, w / 2, y0 + i * lh, w - 8));
  }
  ctx.restore();
}

export async function drawBackground(ctx, page) {
  const { w, h } = SCREEN;
  const bg = page.bg || {};
  ctx.save();
  ctx.fillStyle = bg.color || '#101018';
  ctx.fillRect(0, 0, w, h);
  if (bg.type === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, bg.color || '#101018'); g.addColorStop(1, bg.color2 || '#303060');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  if (bg.type === 'image' && bg.image) {
    const im = await loadImage(bg.image);
    if (im) drawCover(ctx, im, 0, 0, w, h, bg.fit || 'cover');
    if (bg.dim) { ctx.fillStyle = `rgba(0,0,0,${bg.dim})`; ctx.fillRect(0, 0, w, h); }
  }
  ctx.restore();
}

// RGBA -> firmware .565 file: 'K','5',1,flags, w,h (LE), RGB565 LE pixels, [alpha bytes].
export function pack565(rgba, w, h, withAlpha) {
  const n = w * h;
  const out = new Uint8Array(8 + n * 2 + (withAlpha ? n : 0));
  out.set([0x4b, 0x35, 1, withAlpha ? 1 : 0, w & 255, w >> 8, h & 255, h >> 8]);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const v = ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
    out[8 + i * 2] = v & 255;
    out[9 + i * 2] = v >> 8;
    if (withAlpha) out[8 + n * 2 + i] = rgba[i * 4 + 3];
  }
  return out;
}

export function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function canvas(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  return c;
}

export async function renderCapCanvas(key, mosaic = null) {
  const c = canvas(key.w, key.h);
  await drawCap(c.getContext('2d'), key, mosaic);
  return c;
}

// The page's "picture across keys" at screen size (null when the page has none).
export async function renderMosaic(page) {
  const kp = page.keysPic;
  if (!kp?.image) return null;
  const im = await loadImage(kp.image);
  if (!im) return null;
  const c = canvas(SCREEN.w, SCREEN.h);
  const ctx = c.getContext('2d');
  drawCover(ctx, im, 0, 0, SCREEN.w, SCREEN.h, kp.fit || 'cover');
  if (kp.dim) { ctx.fillStyle = `rgba(0,0,0,${kp.dim})`; ctx.fillRect(0, 0, SCREEN.w, SCREEN.h); }
  return c;
}
export async function renderBgCanvas(page) {
  const c = canvas(SCREEN.w, SCREEN.h);
  await drawBackground(c.getContext('2d'), page);
  return c;
}

const isPlainBg = (p) => (p.bg?.type || 'gradient') !== 'image';

// Fingerprint of the whole design, stored in the keypad's config.json so the studio can tell whether
// the keypad has exactly this design (the firmware ignores the field).
export const designHash = (project) => fnv1a(new TextEncoder().encode(JSON.stringify(project)));

// Project -> { config (device JSON), files: Map(path -> Uint8Array) }.
// Keycaps are always rendered into images so fonts/emoji/styles look the same on the device.
export async function compileProject(project) {
  setOrientation(project.rotation || 0);
  const files = new Map();
  const pages = [];
  for (const p of project.pages) {
    const bg = { color: p.bg?.color || '#101018' };
    if ((p.bg?.type || 'gradient') === 'gradient') bg.color2 = p.bg?.color2 || '#303060';
    if (!isPlainBg(p)) {
      const c = await renderBgCanvas(p);
      const data = c.getContext('2d').getImageData(0, 0, SCREEN.w, SCREEN.h).data;
      const bytes = pack565(data, SCREEN.w, SCREEN.h, false);
      const name = `img/${fnv1a(bytes)}.565`;
      files.set(name, bytes);
      bg.img = name;
    }
    const keys = [];
    const mosaic = await renderMosaic(p);
    for (const k of p.keys) {
      const c = await renderCapCanvas(k, mosaic);
      const data = c.getContext('2d').getImageData(0, 0, k.w, k.h).data;
      const bytes = pack565(data, k.w, k.h, true);
      const name = `img/${fnv1a(bytes)}.565`;
      files.set(name, bytes);
      keys.push({
        x: Math.round(k.x), y: Math.round(k.y), w: Math.round(k.w), h: Math.round(k.h), r: k.r ?? 14,
        color: k.color, text: k.text || '#ffffff', label: asciiLabel(k.label), fs: 2, img: name,
        motion: k.motion || 'push', light: k.light || 'glow', fx: k.fx || '#00e5ff', ms: k.ms || 260,
        actions: k.actions || [],
      });
    }
    pages.push({ name: asciiLabel(p.name) || 'Page', bg, keys });
  }
  const config = {
    v: 1, design: designHash(project), name: asciiLabel(project.name) || 'Macro Keypad', brightness: project.brightness ?? 80,
    statusBar: project.statusBar !== false, dim: project.dim, idle: project.idle, rotation: project.rotation || 0, pages,
  };
  return { config, files };
}

// The device's built-in font only has ASCII; images carry the real label, this is the fallback text.
export const asciiLabel = (s) => String(s || '').replace(/\n/g, ' ').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 24);

// Shrinks an uploaded image so projects stay small (stored as a data URL).
export async function importImage(file, maxSide = 640) {
  const url = URL.createObjectURL(file);
  const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const s = Math.min(1, maxSide / Math.max(im.width, im.height));
  const c = document.createElement('canvas');
  c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c.toDataURL(file.type === 'image/png' || file.type === 'image/svg+xml' ? 'image/png' : 'image/jpeg', 0.88);
}
