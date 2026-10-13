import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEYS, codeToKey } from '../public/keys.js';

test('web key table matches firmware/src/keymap.cpp', () => {
  const src = readFileSync(new URL('../../firmware/src/keymap.cpp', import.meta.url), 'utf8');
  const block = src.split('KEYMAP-TABLE-BEGIN')[1].split('KEYMAP-TABLE-END')[0];
  const fw = Object.fromEntries([...block.matchAll(/\{"([a-z0-9_]+)",0x([0-9A-Fa-f]{2})\}/g)].map((m) => [m[1], parseInt(m[2], 16)]));
  assert.ok(Object.keys(fw).length > 100);
  assert.deepEqual(fw, { ...KEYS });
});

test('KeyboardEvent.code maps to firmware names', () => {
  assert.equal(codeToKey('KeyA'), 'a');
  assert.equal(codeToKey('Digit7'), '7');
  assert.equal(codeToKey('Numpad3'), 'kp_3');
  assert.equal(codeToKey('F13'), 'f13');
  assert.equal(codeToKey('ControlLeft'), 'lctrl');
  assert.equal(codeToKey('MetaRight'), 'rgui');
  assert.equal(codeToKey('ArrowUp'), 'up');
  assert.equal(codeToKey('Unknown'), null);
});
