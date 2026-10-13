// Macro recording: turns captured keydown/keyup events (with timestamps) into keypad steps.
import { codeToKey, isModKey, modOf } from './keys.js';

// events: [{type:'down'|'up', code, key, t}] in ms. Returns raw steps that replay exactly, with real timing.
// chars: also keep the typed character (KeyboardEvent.key) on down steps, used by simplifySteps.
export function eventsToRawSteps(events, { minDelay = 10, chars = false } = {}) {
  const steps = [];
  const held = new Set();
  let last = null;
  for (const e of events) {
    const key = codeToKey(e.code);
    if (!key) continue;
    if (e.type === 'down' && held.has(key)) continue;    // auto-repeat
    if (e.type === 'up' && !held.has(key)) continue;
    if (last !== null) {
      const gap = Math.round(e.t - last);
      if (gap >= minDelay) steps.push({ t: 'delay', ms: Math.min(gap, 10000) });
    }
    last = e.t;
    if (e.type === 'down') held.add(key); else held.delete(key);
    const step = { t: e.type, key };
    if (chars && e.type === 'down' && typeof e.key === 'string' && /^[\x20-\x7e]$/.test(e.key)) step.ch = e.key;
    steps.push(step);
  }
  for (const k of held) steps.push({ t: 'up', key: k });   // never leave keys stuck
  return steps;
}

const SHIFTED = { 1: '!', 2: '@', 3: '#', 4: '$', 5: '%', 6: '^', 7: '&', 8: '*', 9: '(', 0: ')',
  minus: '_', equal: '+', lbracket: '{', rbracket: '}', backslash: '|', semicolon: ':', quote: '"',
  grave: '~', comma: '<', period: '>', slash: '?' };
const PLAIN = { space: ' ', minus: '-', equal: '=', lbracket: '[', rbracket: ']', backslash: '\\',
  semicolon: ';', quote: "'", grave: '`', comma: ',', period: '.', slash: '/' };

function charFor(key, shift) {
  if (/^[a-z]$/.test(key)) return shift ? key.toUpperCase() : key;
  if (/^[0-9]$/.test(key)) return shift ? SHIFTED[key] : key;
  if (shift) return SHIFTED[key] ?? null;
  return PLAIN[key] ?? null;
}

// Simplified steps: typed characters merge into text steps, chords become combos,
// pauses shorter than keepPausesOver ms are dropped (0 = drop all pauses).
export function simplifySteps(raw, { keepPausesOver = 400 } = {}) {
  const out = [];
  const mods = new Set();
  let usedMods = false;
  const pushText = (ch) => {
    const prev = out[out.length - 1];
    if (prev && prev.t === 'text') prev.s += ch; else out.push({ t: 'text', s: ch });
  };
  for (const s of raw) {
    if (s.t === 'delay') {
      if (keepPausesOver > 0 && s.ms >= keepPausesOver) out.push({ t: 'delay', ms: s.ms });
      continue;
    }
    if (isModKey(s.key)) {
      if (s.t === 'down') { mods.add(modOf(s.key)); usedMods = false; }
      else {
        mods.delete(modOf(s.key));
        if (!usedMods && mods.size === 0) out.push({ t: 'combo', mods: [modOf(s.key)] });   // lone tap (e.g. Win)
        usedMods = true;
      }
      continue;
    }
    if (s.t === 'up') continue;
    usedMods = true;
    const onlyShift = mods.size === 1 && mods.has('shift');
    const typing = mods.size === 0 || onlyShift;
    const ch = !typing ? null : s.ch ?? charFor(s.key, onlyShift);
    if (ch !== null && ch !== undefined) pushText(ch);
    else if (s.key === 'enter' && mods.size === 0) pushText('\n');
    else out.push({ t: 'combo', mods: [...mods], key: s.key });
  }
  return out;
}

// Browser-side recorder: attach to window, collect events until stop().
export class Recorder {
  constructor() { this.events = []; this.active = false; this._d = (e) => this._on(e, 'down'); this._u = (e) => this._on(e, 'up'); }
  _on(e, type) {
    if (!this.active) return;
    e.preventDefault();
    e.stopPropagation();
    this.events.push({ type, code: e.code, key: e.key, t: e.timeStamp });
    this.onEvent?.(this.events);
  }
  start() {
    this.events = [];
    this.active = true;
    window.addEventListener('keydown', this._d, true);
    window.addEventListener('keyup', this._u, true);
  }
  stop() {
    this.active = false;
    window.removeEventListener('keydown', this._d, true);
    window.removeEventListener('keyup', this._u, true);
    return this.events;
  }
}
