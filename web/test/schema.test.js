import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, validateAction } from '../public/schema.js';

const base = () => ({ v: 1, name: 'K', idle: { effect: 'breathe' }, pages: [{ name: 'P', bg: { color: '#000000' }, keys: [
  { x: 10, y: 30, w: 90, h: 90, color: '#ff0000', motion: 'push', light: 'glow', actions: [{ t: 'combo', mods: ['ctrl'], key: 'c' }] },
] }] });

test('valid config passes', () => assert.deepEqual(validateConfig(base()), []));

test('rejects unknown keys, bad text and off-screen keys', () => {
  const c = base();
  c.pages[0].keys[0].actions.push({ t: 'combo', key: 'nope' }, { t: 'text', s: 'สวัสดี' }, { t: 'delay', ms: 99999 });
  c.pages[0].keys.push({ x: 300, y: 30, w: 90, h: 90 });
  const errs = validateConfig(c).join('\n');
  assert.match(errs, /unknown key "nope"/);
  assert.match(errs, /ASCII/);
  assert.match(errs, /delay/);
  assert.match(errs, /outside/);
});

test('action validation', () => {
  assert.equal(validateAction({ t: 'down', key: 'lshift' }), null);
  assert.equal(validateAction({ t: 'combo', mods: ['gui'] }), null);
  assert.match(validateAction({ t: 'combo' }), /empty/);
  assert.match(validateAction({ t: 'wiggle' }), /unknown action/);
});

test('orientation: screen size and bounds follow the rotation', async () => {
  const { screenFor, setOrientation, SCREEN } = await import('../public/schema.js');
  assert.deepEqual(screenFor(0), { w: 320, h: 480 });
  assert.deepEqual(screenFor(1), { w: 480, h: 320 });
  assert.deepEqual(screenFor(3), { w: 480, h: 320 });
  setOrientation(1);
  assert.equal(SCREEN.w, 480);
  setOrientation(0);
  const wide = { pages: [{ name: 'P', keys: [{ x: 10, y: 30, w: 400, h: 80, actions: [] }] }] };
  assert.match(validateConfig(wide).join(), /outside the 320x480/);
  assert.deepEqual(validateConfig({ ...wide, rotation: 1 }), []);
  assert.match(validateConfig({ ...wide, rotation: 7 }).join(), /rotation/);
});
