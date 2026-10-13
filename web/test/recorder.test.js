import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventsToRawSteps, simplifySteps } from '../public/macro-recorder.js';

const ev = (list) => list.map(([type, code, t]) => ({ type, code, t }));

test('raw steps keep timing and drop auto-repeat', () => {
  const raw = eventsToRawSteps(ev([['down', 'KeyH', 0], ['down', 'KeyH', 30], ['up', 'KeyH', 80], ['down', 'KeyI', 300], ['up', 'KeyI', 340]]));
  assert.deepEqual(raw, [
    { t: 'down', key: 'h' }, { t: 'delay', ms: 80 }, { t: 'up', key: 'h' }, { t: 'delay', ms: 220 },
    { t: 'down', key: 'i' }, { t: 'delay', ms: 40 }, { t: 'up', key: 'i' },
  ]);
});

test('held keys are released at the end', () => {
  const raw = eventsToRawSteps(ev([['down', 'ShiftLeft', 0]]));
  assert.deepEqual(raw.at(-1), { t: 'up', key: 'lshift' });
});

test('simplify merges typing into text and chords into combos', () => {
  const raw = eventsToRawSteps(ev([
    ['down', 'ShiftLeft', 0], ['down', 'KeyH', 10], ['up', 'KeyH', 20], ['up', 'ShiftLeft', 30],
    ['down', 'KeyI', 40], ['up', 'KeyI', 50], ['down', 'Digit1', 60], ['up', 'Digit1', 70],
    ['down', 'ControlLeft', 1000], ['down', 'KeyS', 1010], ['up', 'KeyS', 1020], ['up', 'ControlLeft', 1030],
    ['down', 'MetaLeft', 1100], ['up', 'MetaLeft', 1150],
  ]));
  assert.deepEqual(simplifySteps(raw, { keepPausesOver: 500 }), [
    { t: 'text', s: 'Hi1' }, { t: 'delay', ms: 930 }, { t: 'combo', mods: ['ctrl'], key: 's' }, { t: 'combo', mods: ['gui'] },
  ]);
});

test('simplify uses the typed character when available', () => {
  const raw = eventsToRawSteps([
    { type: 'down', code: 'KeyH', key: 'H', t: 0 }, { type: 'up', code: 'KeyH', key: 'H', t: 5 },
    { type: 'down', code: 'Digit1', key: '!', t: 10 }, { type: 'up', code: 'Digit1', key: '!', t: 15 },
  ], { chars: true });
  assert.deepEqual(simplifySteps(raw), [{ t: 'text', s: 'H!' }]);
});
