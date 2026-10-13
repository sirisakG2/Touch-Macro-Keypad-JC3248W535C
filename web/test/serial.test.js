import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SerialLink } from '../public/transport.js';

// Minimal Web Serial port: readable/writable web streams like Chrome's SerialPort.
function fakePort() {
  let ctrl;
  const port = {
    readable: new ReadableStream({ start: (c) => (ctrl = c) }),
    writable: new WritableStream({ write() {} }),
    async open() {},
    async close() { if (port.readable.locked) throw new Error('readable locked'); port.closed = true; },
    push: (text) => ctrl.enqueue(new TextEncoder().encode(text)),
  };
  return port;
}

test('lines are delivered and close() finishes without spinning', async () => {
  const port = fakePort();
  const link = new SerialLink();
  const lines = [];
  let closes = 0;
  link.onLine = (l) => lines.push(l);
  link.onClose = () => closes++;
  await link.open(port);
  port.push('{"ev":"press"}\n{"id":1');
  port.push(',"ok":true}\n');
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(lines, ['{"ev":"press"}', '{"id":1,"ok":true}']);

  const t0 = Date.now();
  await link.close();                       // froze the page before the fix
  assert.ok(Date.now() - t0 < 500);
  assert.equal(port.closed, true);           // reader lock released before port.close()
  assert.equal(closes, 1);
});
