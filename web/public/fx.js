// Live preview of the keypad screen. The animation math mirrors firmware/src/ui.cpp so what you
// see here is what the device does (press motion, light effects, idle ambience, status/page bars).
import { SCREEN } from './schema.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t) => { t = clamp01(t); return 1 - (1 - t) ** 3; };

export function pressAmount(k, a, now) {
  if (!a.pressT) return 0;
  const ms = k.ms || 260, inD = Math.max(40, ms * 0.35), outD = Math.max(60, ms * 0.65);
  if (a.down) return easeOut((now - a.pressT) / inD);
  return a.atRelease * (1 - easeOut((now - a.releaseT) / outD));
}

export function keyTransform(k, a, now) {
  const amt = pressAmount(k, a, now);
  let scale = 1, dy = 0, dim = 1;
  switch (k.motion || 'push') {
    case 'push': scale = 1 - 0.08 * amt; break;
    case 'pop': scale = 1 + 0.06 * amt; break;
    case 'sink': dy = 5 * amt; dim = 1 - 0.25 * amt; break;
    case 'bounce':
      scale = 1 - 0.1 * amt;
      if (!a.down && a.pressT) {
        const s = clamp01((now - a.releaseT) / Math.max(k.ms || 260, 60));
        scale += 0.07 * Math.sin(Math.PI * s * 2) * (1 - s) * a.atRelease;
      }
      break;
  }
  return { amt, scale, dy, dim };
}

export function idleGlow(idle, i, k, now) {
  const period = 6000 - (idle.speed ?? 40) * 50, ph = now / period;
  switch (idle.effect) {
    case 'breathe': return { g: 0.15 + 0.45 * (0.5 + 0.5 * Math.sin(2 * Math.PI * ph)), c: idle.color };
    case 'rainbow': return { g: 0.55, c: `hsl(${(ph * 360 + i * 28) % 360} 100% 50%)` };
    case 'wave': return { g: 0.6 * (0.5 + 0.5 * Math.sin(2 * Math.PI * ph - (k.x + k.y) / 90)) ** 2, c: idle.color };
    default: return { g: 0, c: idle.color };
  }
}

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2))); }

function glow(ctx, x, y, w, h, r, spread, color, alpha) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.shadowColor = color;
  ctx.shadowBlur = spread;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  for (let i = 0; i < 2; i++) { rr(ctx, x, y, w, h, r); ctx.stroke(); }
  ctx.restore();
}

export class Preview {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.anims = [];
    this.lastTouch = performance.now();
    this.idleForce = false;
    this.selected = -1;
    this.showGuides = true;
  }
  // project, page index, cap canvases per key, background canvas
  set(project, pageIdx, caps, bg) { this.project = project; this.page = pageIdx; this.caps = caps; this.bg = bg; }
  press(i, x, y, now = performance.now()) {
    this.anims[i] = { pressT: now, down: true, rx: x, ry: y, atRelease: 0, releaseT: 0 };
    this.lastTouch = now;
  }
  release(now = performance.now()) {
    const keys = this.project.pages[this.page].keys;
    this.anims.forEach((a, i) => {
      if (!a?.down) return;
      a.atRelease = pressAmount(keys[i], a, now);
      a.down = false;
      a.releaseT = now;
    });
  }
  touch() { this.lastTouch = performance.now(); }
  draw(now = performance.now()) {
    const { ctx, project } = this;
    if (!project) return;
    const page = project.pages[this.page];
    ctx.save();
    ctx.clearRect(0, 0, SCREEN.w, SCREEN.h);
    if (this.bg) ctx.drawImage(this.bg, 0, 0);
    const idle = project.idle || {};
    const idleOn = idle.effect && idle.effect !== 'none' && (this.idleForce || now - this.lastTouch > (idle.after ?? 20) * 1000);
    page.keys.forEach((k, i) => {
      const a = this.anims[i] || {};
      const { amt, scale, dy, dim } = keyTransform(k, a, now);
      const w = k.w * scale, h = k.h * scale, x = k.x + (k.w - w) / 2, y = k.y + (k.h - h) / 2 + dy, r = (k.r ?? 14) * scale;
      if (idleOn) { const ig = idleGlow(idle, i, k, now); glow(ctx, x, y, w, h, r, 12, ig.c, ig.g); }
      if ((k.light || 'glow') === 'glow') glow(ctx, x, y, w, h, r, 16, k.fx || '#00e5ff', amt);
      const cap = this.caps?.[i];
      if (cap) {
        ctx.save();
        if (dim < 1) ctx.filter = `brightness(${dim})`;
        ctx.drawImage(cap, x, y, w, h);
        ctx.restore();
      }
      if (k.light === 'flash' && amt > 0) { ctx.save(); ctx.globalAlpha = 0.55 * amt; ctx.fillStyle = k.fx || '#00e5ff'; rr(ctx, x, y, w, h, r); ctx.fill(); ctx.restore(); }
      if (k.light === 'outline' && amt > 0) { ctx.save(); ctx.globalAlpha = amt; ctx.strokeStyle = k.fx || '#00e5ff'; ctx.lineWidth = 3; rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r); ctx.stroke(); ctx.restore(); }
      if (k.light === 'ripple' && a.pressT) {
        const t = (now - a.pressT) / ((k.ms || 260) * 2);
        if (t < 1) {
          ctx.save(); ctx.globalAlpha = (1 - t) * 0.9; ctx.strokeStyle = k.fx || '#00e5ff'; ctx.lineWidth = 3 + 3 * (1 - t);
          ctx.beginPath(); ctx.arc(a.rx, a.ry, 8 + t * Math.max(k.w, k.h) * 0.9, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
      }
      if (this.showGuides && i === this.selected) {
        ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
        ctx.strokeRect(k.x - 2.5, k.y - 2.5, k.w + 5, k.h + 5);
        ctx.fillStyle = '#ffffff'; ctx.setLineDash([]);
        ctx.fillRect(k.x + k.w - 3, k.y + k.h - 3, 9, 9);   // resize handle
        ctx.restore();
      }
    });
    this.drawBars(ctx, page);
    ctx.restore();
  }
  drawBars(ctx, page) {
    const { project } = this;
    ctx.save();
    ctx.font = 'bold 15px monospace';
    ctx.textBaseline = 'top';
    if (project.statusBar !== false) {
      ctx.fillStyle = 'rgba(0,0,0,0.59)'; ctx.fillRect(0, 0, SCREEN.w, SCREEN.statusH);
      ctx.fillStyle = '#fff'; ctx.fillText((page.name || '').slice(0, 14), 6, 4);
      ctx.fillStyle = '#00ff00'; ctx.textAlign = 'right'; ctx.fillText(this.link || 'USB', SCREEN.w - 6, 4);
    }
    const n = project.pages.length;
    if (n > 1) {
      const y = SCREEN.h - SCREEN.navH;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.59)'; ctx.fillRect(0, y, SCREEN.w, SCREEN.navH);
      ctx.fillStyle = '#424242'; rr(ctx, 6, y + 5, 70, SCREEN.navH - 10, 10); ctx.fill(); rr(ctx, SCREEN.w - 76, y + 5, 70, SCREEN.navH - 10, 10); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 22px monospace'; ctx.textBaseline = 'middle';
      ctx.fillText('<', 41, y + SCREEN.navH / 2); ctx.fillText('>', SCREEN.w - 41, y + SCREEN.navH / 2);
      const gap = Math.min(18, 150 / n), x0 = SCREEN.w / 2 - ((n - 1) * gap) / 2;
      for (let i = 0; i < n; i++) { ctx.fillStyle = i === this.page ? '#fff' : '#6b6b6b'; ctx.beginPath(); ctx.arc(x0 + i * gap, y + SCREEN.navH / 2, 4, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }
}
