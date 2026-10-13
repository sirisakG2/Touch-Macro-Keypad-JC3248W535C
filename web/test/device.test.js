import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Device, crc32, toB64, fromB64 } from '../public/transport.js';

// In-memory stand-in for firmware/src/proto.cpp file commands.
class FakeKeypad {
  constructor() { this.files = new Map(); this.up = null; this.kind = 'usb'; this.chunk = 1000; }
  async send(line) {
    const req = JSON.parse(line);
    const res = { id: req.id, ok: true };
    const fail = (e) => { res.ok = false; res.err = e; };
    switch (req.cmd) {
      case 'wbegin': this.up = { name: req.name, size: req.size, parts: [], done: 0, crc: 0 }; break;
      case 'wchunk': {
        if (req.off !== this.up.done) { fail('offset'); break; }
        const b = fromB64(req.data);
        this.up.parts.push(b); this.up.done += b.length; this.up.crc = crc32(b, this.up.crc);
        break;
      }
      case 'wend': {
        if (req.crc !== this.up.crc || this.up.done !== this.up.size) { fail('crc mismatch'); break; }
        const all = new Uint8Array(this.up.done); let o = 0;
        for (const p of this.up.parts) { all.set(p, o); o += p.length; }
        this.files.set('/' + this.up.name, all);
        break;
      }
      case 'read': {
        const f = this.files.get('/' + req.name);
        const part = f.subarray(req.off, req.off + req.len);
        Object.assign(res, { size: f.length, n: part.length, data: toB64(part) });
        break;
      }
      case 'ls': res.files = [...this.files].map(([n, b]) => ({ n, s: b.length })); break;
      default: fail('unknown cmd');
    }
    queueMicrotask(() => this.onLine(JSON.stringify(res)));
  }
}

test('writeFile/readFile round trip with chunking and CRC', async () => {
  const link = new FakeKeypad();
  const dev = new Device(link);
  const data = new Uint8Array(7777).map((_, i) => (i * 31) & 255);
  let last = 0;
  await dev.writeFile('img/abc.565', data, (a) => (last = a));
  assert.equal(last, data.length);
  assert.deepEqual((await dev.list())[0], { n: '/img/abc.565', s: 7777 });
  assert.deepEqual(await dev.readFile('img/abc.565'), data);
});

test('device errors reject the rpc', async () => {
  const dev = new Device(new FakeKeypad());
  await assert.rejects(dev.rpc('nope'), /unknown cmd/);
});
