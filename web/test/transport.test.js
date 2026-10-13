import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, toB64, fromB64 } from '../public/transport.js';
import { pack565, fnv1a } from '../public/designer.js';

test('crc32 matches zlib and chains', () => {
  const b = new TextEncoder().encode('123456789');
  assert.equal(crc32(b), 0xcbf43926);
  assert.equal(crc32(b.subarray(4), crc32(b.subarray(0, 4))), 0xcbf43926);
});

test('base64 round trip', () => {
  const b = new Uint8Array(70000).map((_, i) => (i * 7) & 255);
  assert.deepEqual(fromB64(toB64(b)), b);
});

test('pack565 writes the firmware header, LE pixels and alpha', () => {
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]);
  const out = pack565(rgba, 2, 1, true);
  assert.deepEqual([...out.subarray(0, 8)], [0x4b, 0x35, 1, 1, 2, 0, 1, 0]);
  assert.deepEqual([...out.subarray(8, 12)], [0x00, 0xf8, 0xe0, 0x07]);   // red 0xF800, green 0x07E0
  assert.deepEqual([...out.subarray(12)], [255, 128]);
  assert.equal(fnv1a(out).length, 8);
});

test('designHash is stable for the same design and changes with any edit', async () => {
  const { designHash } = await import('../public/designer.js');
  const p = { name: 'K', pages: [{ name: 'P', keys: [{ label: 'Copy', actions: [{ t: 'combo', mods: ['gui'], key: 'c' }] }] }] };
  assert.equal(designHash(p), designHash(JSON.parse(JSON.stringify(p))));
  const q = JSON.parse(JSON.stringify(p));
  q.pages[0].keys[0].label = 'Copy!';
  assert.notEqual(designHash(p), designHash(q));
});

test('icon library: data, SVG output and search', async () => {
  const { readFileSync } = await import('node:fs');
  const { setIconData, iconSvg, searchIcons, ICON_GROUPS } = await import('../public/icons.js');
  const d = JSON.parse(readFileSync(new URL('../public/icons/lucide.json', import.meta.url)));
  assert.ok(Object.keys(d.icons).length > 1000);
  assert.match(d.license, /ISC/);
  setIconData(d);
  const svg = iconSvg('copy', '#ff0000');
  assert.match(svg, /^<svg[^>]+stroke="#ff0000"/);
  assert.match(svg, /<(path|rect)/);
  assert.equal(iconSvg('no-such-icon'), null);
  assert.equal(searchIcons('copy')[0], 'copy');
  assert.ok(searchIcons('sound').some((n) => n.startsWith('volume')));    // found through Lucide tags
  assert.ok(ICON_GROUPS.Popular.filter((n) => d.icons[n]).length > 40);
});
