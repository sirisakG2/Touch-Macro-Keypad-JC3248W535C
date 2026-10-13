// Device link over Web Serial (USB CDC) or Web Bluetooth (Nordic UART service).
// Both speak the firmware's line-delimited JSON protocol (firmware/src/proto.h).

export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

// zlib-compatible CRC-32 (matches esp_rom_crc32_le chaining on the device).
export function crc32(bytes, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// CRC as a signed 32-bit number: firmware <= 1.3.1 parsed it as an int and turned values above
// INT32_MAX into 0 ("crc mismatch"). Same bits, so newer firmware reads it either way.
const wireCrc = (bytes) => crc32(bytes) | 0;

export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

class LineLink {
  constructor() { this._buf = ''; this.onLine = null; this.onClose = null; }
  _feed(text) {
    this._buf += text;
    let i;
    while ((i = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, i).trim();
      this._buf = this._buf.slice(i + 1);
      if (line) this.onLine?.(line);
    }
  }
}

export class SerialLink extends LineLink {
  kind = 'usb';
  chunk = 3072;   // bytes of file data per wchunk
  static supported() { return 'serial' in navigator; }
  async open(port) {
    this.port = port || await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x303a }] });
    await this.port.open({ baudRate: 115200, bufferSize: 65536 });
    await this.port.setSignals?.({ dataTerminalReady: true }).catch(() => {});
    this.writer = this.port.writable.getWriter();
    this._loop = this._readLoop();
  }
  async _readLoop() {
    const dec = new TextDecoder();
    try {
      // One reader for the life of the connection. `done` means the stream was cancelled or closed:
      // stop. (Re-acquiring a reader on a closed stream returned `done` instantly and spun forever,
      // freezing the page when the keypad restarted after a firmware update.)
      this.reader = this.port.readable.getReader();
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        this._feed(dec.decode(value, { stream: true }));
      }
    } catch (e) { /* device unplugged */ }
    try { this.reader?.releaseLock(); } catch {}
    this.onClose?.();
  }
  async send(line) { await this.writer.write(new TextEncoder().encode(line + '\n')); }
  async close() {
    this.closing = true;
    try { await this.reader?.cancel(); } catch {}
    try { await this._loop; } catch {}   // wait until the reader lock is released
    try { this.writer?.releaseLock(); } catch {}
    try { await this.port?.close(); } catch {}
  }
}

export class BleLink extends LineLink {
  kind = 'ble';
  chunk = 360;
  static supported() { return 'bluetooth' in navigator; }
  async open() {
    this.device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [NUS_SERVICE] });
    this.device.addEventListener('gattserverdisconnected', () => this.onClose?.());
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService(NUS_SERVICE);
    this.rx = await svc.getCharacteristic(NUS_RX);
    this.tx = await svc.getCharacteristic(NUS_TX);
    const dec = new TextDecoder();
    this.tx.addEventListener('characteristicvaluechanged', (e) => this._feed(dec.decode(e.target.value, { stream: true })));
    await this.tx.startNotifications();
    this._q = Promise.resolve();
  }
  send(line) {
    const bytes = new TextEncoder().encode(line + '\n');
    this._q = this._q.then(async () => {
      for (let i = 0; i < bytes.length; i += 180) await this.rx.writeValueWithResponse(bytes.subarray(i, i + 180));
    });
    return this._q;
  }
  async close() { try { this.device?.gatt.disconnect(); } catch {} }
}

// RPC + file transfer on top of a link.
export class Device {
  constructor(link) {
    this.link = link;
    this.nextId = 1;
    this.pending = new Map();
    this.onEvent = null;
    this.onClose = null;
    link.onLine = (line) => this._line(line);
    link.onClose = () => {
      for (const p of this.pending.values()) p.reject(new Error('disconnected'));
      this.pending.clear();
      this.onClose?.();
    };
  }
  // port: a previously granted Web Serial port to reopen without the picker (after a reboot).
  static async connect(kind, port) {
    const link = kind === 'ble' ? new BleLink() : new SerialLink();
    await link.open(port);
    const dev = new Device(link);
    dev.info = await dev.rpc('hello', {}, 3000).catch(async () => dev.rpc('hello', {}, 3000));
    return dev;
  }
  get kind() { return this.link.kind; }
  _line(line) {
    if (line[0] !== '{') return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.ev) { this.onEvent?.(msg); return; }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    msg.ok ? p.resolve(msg) : p.reject(new Error(msg.err || 'device error'));
  }
  rpc(cmd, params = {}, timeout = 8000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${cmd}: timeout`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.link.send(JSON.stringify({ id, cmd, ...params })).catch((e) => { clearTimeout(timer); this.pending.delete(id); reject(e); });
    });
  }
  async list() { return (await this.rpc('ls')).files; }
  async writeFile(name, bytes, onProgress) {
    await this.rpc('wbegin', { name, size: bytes.length });
    for (let off = 0; off < bytes.length; off += this.link.chunk) {
      const part = bytes.subarray(off, off + this.link.chunk);
      await this.rpc('wchunk', { off, data: toB64(part) });
      onProgress?.(Math.min(off + part.length, bytes.length), bytes.length);
    }
    await this.rpc('wend', { crc: wireCrc(bytes) }, 15000);
  }
  async readFile(name) {
    const parts = [];
    let off = 0, size = Infinity;
    while (off < size) {
      const r = await this.rpc('read', { name, off, len: this.kind === 'ble' ? 1024 : 3072 });
      size = r.size;
      if (!r.n) break;
      parts.push(fromB64(r.data));
      off += r.n;
    }
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  // Firmware update over USB: the keypad writes the image to its spare app slot, verifies it and reboots.
  async updateFirmware(bytes, onProgress) {
    if (this.kind !== 'usb') throw new Error('connect over USB to update the firmware');
    await this.rpc('ota_begin', { size: bytes.length }, 20000);   // erases the slot
    for (let off = 0; off < bytes.length; off += this.link.chunk) {
      const part = bytes.subarray(off, off + this.link.chunk);
      await this.rpc('ota_chunk', { off, data: toB64(part) }, 15000);
      onProgress?.(Math.min(off + part.length, bytes.length), bytes.length);
    }
    await this.rpc('ota_end', { crc: wireCrc(bytes) }, 20000);
  }
  remove(name) { return this.rpc('rm', { name }); }
  apply() { return this.rpc('apply', {}, 15000); }
  close() { return this.link.close(); }
}
