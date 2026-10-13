// Key names <-> HID usages. Must match firmware/src/keymap.cpp (checked by web/test/keymap.test.js).
export const KEYS = {
  a: 0x04, b: 0x05, c: 0x06, d: 0x07, e: 0x08, f: 0x09, g: 0x0a, h: 0x0b, i: 0x0c, j: 0x0d, k: 0x0e, l: 0x0f,
  m: 0x10, n: 0x11, o: 0x12, p: 0x13, q: 0x14, r: 0x15, s: 0x16, t: 0x17, u: 0x18, v: 0x19, w: 0x1a, x: 0x1b,
  y: 0x1c, z: 0x1d,
  1: 0x1e, 2: 0x1f, 3: 0x20, 4: 0x21, 5: 0x22, 6: 0x23, 7: 0x24, 8: 0x25, 9: 0x26, 0: 0x27,
  enter: 0x28, esc: 0x29, backspace: 0x2a, tab: 0x2b, space: 0x2c, minus: 0x2d, equal: 0x2e, lbracket: 0x2f,
  rbracket: 0x30, backslash: 0x31, semicolon: 0x33, quote: 0x34, grave: 0x35, comma: 0x36, period: 0x37,
  slash: 0x38, capslock: 0x39,
  f1: 0x3a, f2: 0x3b, f3: 0x3c, f4: 0x3d, f5: 0x3e, f6: 0x3f, f7: 0x40, f8: 0x41, f9: 0x42, f10: 0x43,
  f11: 0x44, f12: 0x45,
  printscreen: 0x46, scrolllock: 0x47, pause: 0x48, insert: 0x49, home: 0x4a, pageup: 0x4b, delete: 0x4c,
  end: 0x4d, pagedown: 0x4e, right: 0x4f, left: 0x50, down: 0x51, up: 0x52, numlock: 0x53,
  kp_slash: 0x54, kp_asterisk: 0x55, kp_minus: 0x56, kp_plus: 0x57, kp_enter: 0x58, kp_1: 0x59, kp_2: 0x5a,
  kp_3: 0x5b, kp_4: 0x5c, kp_5: 0x5d, kp_6: 0x5e, kp_7: 0x5f, kp_8: 0x60, kp_9: 0x61, kp_0: 0x62, kp_dot: 0x63,
  intl_backslash: 0x64, menu: 0x65,
  f13: 0x68, f14: 0x69, f15: 0x6a, f16: 0x6b, f17: 0x6c, f18: 0x6d, f19: 0x6e, f20: 0x6f, f21: 0x70,
  f22: 0x71, f23: 0x72, f24: 0x73,
  lctrl: 0xe0, lshift: 0xe1, lalt: 0xe2, lgui: 0xe3, rctrl: 0xe4, rshift: 0xe5, ralt: 0xe6, rgui: 0xe7,
};

export const MODS = ['ctrl', 'shift', 'alt', 'gui'];
export const MOD_KEYS = ['lctrl', 'lshift', 'lalt', 'lgui', 'rctrl', 'rshift', 'ralt', 'rgui'];

// KeyboardEvent.code -> firmware key name.
const CODE = {
  Enter: 'enter', Escape: 'esc', Backspace: 'backspace', Tab: 'tab', Space: 'space', Minus: 'minus',
  Equal: 'equal', BracketLeft: 'lbracket', BracketRight: 'rbracket', Backslash: 'backslash',
  Semicolon: 'semicolon', Quote: 'quote', Backquote: 'grave', Comma: 'comma', Period: 'period', Slash: 'slash',
  CapsLock: 'capslock', PrintScreen: 'printscreen', ScrollLock: 'scrolllock', Pause: 'pause', Insert: 'insert',
  Home: 'home', PageUp: 'pageup', Delete: 'delete', End: 'end', PageDown: 'pagedown', ArrowRight: 'right',
  ArrowLeft: 'left', ArrowDown: 'down', ArrowUp: 'up', NumLock: 'numlock', NumpadDivide: 'kp_slash',
  NumpadMultiply: 'kp_asterisk', NumpadSubtract: 'kp_minus', NumpadAdd: 'kp_plus', NumpadEnter: 'kp_enter',
  NumpadDecimal: 'kp_dot', IntlBackslash: 'intl_backslash', ContextMenu: 'menu',
  ControlLeft: 'lctrl', ShiftLeft: 'lshift', AltLeft: 'lalt', MetaLeft: 'lgui', OSLeft: 'lgui',
  ControlRight: 'rctrl', ShiftRight: 'rshift', AltRight: 'ralt', MetaRight: 'rgui', OSRight: 'rgui',
};

export function codeToKey(code) {
  if (!code) return null;
  if (CODE[code]) return CODE[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1].toLowerCase();
  m = /^Digit([0-9])$/.exec(code);
  if (m) return m[1];
  m = /^Numpad([0-9])$/.exec(code);
  if (m) return 'kp_' + m[1];
  m = /^F([0-9]{1,2})$/.exec(code);
  if (m && +m[1] >= 1 && +m[1] <= 24) return 'f' + m[1];
  return null;
}

export const isModKey = (k) => MOD_KEYS.includes(k);
// lctrl/rctrl -> ctrl etc. (combos use generic left-hand modifier names)
export const modOf = (k) => (isModKey(k) ? k.slice(1) : null);

const PRETTY = {
  ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', gui: 'Win/Cmd', esc: 'Esc', enter: 'Enter', space: 'Space',
  backspace: 'Backspace', tab: 'Tab', left: '←', right: '→', up: '↑', down: '↓', pageup: 'PgUp',
  pagedown: 'PgDn', delete: 'Del', insert: 'Ins', printscreen: 'PrtSc',
};
export const prettyKey = (k) => PRETTY[k] || (k.length === 1 ? k.toUpperCase() : k.replace('kp_', 'Num ').toUpperCase());
export const comboText = (a) => [...(a.mods || []).map(prettyKey), a.key ? prettyKey(a.key) : null].filter(Boolean).join(' + ');
