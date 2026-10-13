// Device config validation. LIMITS mirror firmware/src/config.h.
import { KEYS, MODS } from './keys.js';

export const LIMITS = { pages: 16, keys: 40, actions: 200, text: 1024, delay: 10000, configBytes: 256 * 1024 };
export const SCREEN = { w: 320, h: 480, statusH: 22, navH: 44 };
export const MOTIONS = ['none', 'push', 'pop', 'sink', 'bounce'];
export const LIGHTS = ['none', 'glow', 'ripple', 'flash', 'outline'];
export const IDLES = ['none', 'breathe', 'rainbow', 'wave'];

const MOD_NAMES = [...MODS, 'lctrl', 'lshift', 'lalt', 'lgui', 'rctrl', 'rshift', 'ralt', 'rgui', 'cmd', 'win', 'meta', 'option'];
const isHex = (s) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
const isAscii = (s) => /^[\x09\x0a\x20-\x7e]*$/.test(s);

export function validateAction(a) {
  switch (a?.t) {
    case 'combo':
      for (const m of a.mods || []) if (!MOD_NAMES.includes(m)) return `unknown modifier "${m}"`;
      if (a.key && !(a.key in KEYS)) return `unknown key "${a.key}"`;
      if (!a.key && !(a.mods || []).length) return 'empty combo';
      return null;
    case 'text':
      if (typeof a.s !== 'string') return 'text missing';
      if (a.s.length > LIMITS.text) return 'text too long';
      if (!isAscii(a.s)) return 'text can only contain plain ASCII characters (US layout)';
      return null;
    case 'delay':
      if (!(a.ms >= 0 && a.ms <= LIMITS.delay)) return `delay must be 0-${LIMITS.delay} ms`;
      return null;
    case 'down':
    case 'up':
      if (!(a.key in KEYS)) return `unknown key "${a.key}"`;
      return null;
    default:
      return `unknown action "${a?.t}"`;
  }
}

// Returns a list of error strings; empty when the config is valid for the firmware.
export function validateConfig(cfg) {
  const errs = [];
  if (!cfg || !Array.isArray(cfg.pages) || !cfg.pages.length) return ['config needs at least one page'];
  if (cfg.pages.length > LIMITS.pages) errs.push(`max ${LIMITS.pages} pages`);
  if (cfg.idle && !IDLES.includes(cfg.idle.effect)) errs.push(`unknown idle effect "${cfg.idle.effect}"`);
  cfg.pages.forEach((p, pi) => {
    const where = `page ${pi + 1} "${p.name}"`;
    if (p.bg?.color && !isHex(p.bg.color)) errs.push(`${where}: bad background colour`);
    if ((p.keys || []).length > LIMITS.keys) errs.push(`${where}: max ${LIMITS.keys} keys`);
    (p.keys || []).forEach((k, ki) => {
      const kw = `${where}, key ${ki + 1} "${k.label || ''}"`;
      if (![k.x, k.y, k.w, k.h].every(Number.isFinite)) errs.push(`${kw}: position/size missing`);
      if (k.w < 8 || k.h < 8 || k.x < 0 || k.y < 0 || k.x + k.w > SCREEN.w || k.y + k.h > SCREEN.h)
        errs.push(`${kw}: outside the 320x480 screen`);
      if (k.color && !isHex(k.color)) errs.push(`${kw}: bad colour`);
      if (k.motion && !MOTIONS.includes(k.motion)) errs.push(`${kw}: unknown motion "${k.motion}"`);
      if (k.light && !LIGHTS.includes(k.light)) errs.push(`${kw}: unknown light "${k.light}"`);
      if ((k.actions || []).length > LIMITS.actions) errs.push(`${kw}: max ${LIMITS.actions} steps`);
      (k.actions || []).forEach((a, ai) => {
        const e = validateAction(a);
        if (e) errs.push(`${kw}, step ${ai + 1}: ${e}`);
      });
    });
  });
  const bytes = new TextEncoder().encode(JSON.stringify(cfg)).length;
  if (bytes > LIMITS.configBytes) errs.push(`config is ${bytes} bytes, max ${LIMITS.configBytes}`);
  return errs;
}
