// Click sounds played on the PC's speakers when the keypad reports a key press.
// Presets are synthesised with Web Audio (no files); custom sounds are decoded from a data URL.
export const SOUND_PRESETS = { mech: 'Mechanical', soft: 'Soft tap', typewriter: 'Typewriter', bubble: 'Bubble', beep: 'Beep', wood: 'Wood block' };

let ctx;
const custom = new Map();
function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noise(c, dur) {
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource();
  s.buffer = b;
  return s;
}
function env(c, out, t, peak, dur) {
  const g = c.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(out);
  return g;
}
function tone(c, out, type, f0, f1, t, peak, dur) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  o.connect(env(c, out, t, peak, dur));
  o.start(t); o.stop(t + dur + 0.02);
}
function burst(c, out, type, freq, q, t, peak, dur) {
  const n = noise(c, dur + 0.02), f = c.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  n.connect(f); f.connect(env(c, out, t, peak, dur));
  n.start(t);
}

export async function playClick(sound, volume = 0.6) {
  if (!sound || sound === 'none') return;
  const c = ac(), t = c.currentTime + 0.001;
  const out = c.createGain();
  out.gain.value = volume;
  out.connect(c.destination);
  switch (sound) {
    case 'mech': burst(c, out, 'bandpass', 3200, 1.2, t, 0.9, 0.03); tone(c, out, 'sine', 180, 90, t, 0.5, 0.05); break;
    case 'soft': tone(c, out, 'sine', 620, 420, t, 0.5, 0.05); break;
    case 'typewriter': burst(c, out, 'highpass', 2500, 0.7, t, 0.9, 0.025); tone(c, out, 'triangle', 2400, 0, t + 0.004, 0.25, 0.08); break;
    case 'bubble': tone(c, out, 'sine', 380, 900, t, 0.6, 0.07); break;
    case 'beep': tone(c, out, 'square', 1000, 0, t, 0.15, 0.06); break;
    case 'wood': tone(c, out, 'triangle', 820, 600, t, 0.7, 0.07); burst(c, out, 'bandpass', 1500, 4, t, 0.3, 0.02); break;
    default: {
      const buf = await customBuffer(sound);
      if (!buf) return;
      const s = c.createBufferSource();
      s.buffer = buf; s.connect(out); s.start(t);
    }
  }
}

async function customBuffer(dataUrl) {
  if (!dataUrl?.startsWith('data:')) return null;
  if (!custom.has(dataUrl)) {
    custom.set(dataUrl, fetch(dataUrl).then((r) => r.arrayBuffer()).then((ab) => ac().decodeAudioData(ab)).catch(() => null));
  }
  return custom.get(dataUrl);
}
