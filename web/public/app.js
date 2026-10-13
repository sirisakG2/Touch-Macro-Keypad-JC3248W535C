// Macro Keypad Studio - main controller.
import { KEYS, MODS, codeToKey, comboText, prettyKey } from './keys.js';
import { SCREEN, MOTIONS, LIGHTS, IDLES, validateConfig } from './schema.js';
import { Device, SerialLink, BleLink } from './transport.js';
import { STYLES, FONTS, compileProject, designHash, drawCap, renderCapCanvas, renderBgCanvas, importImage, asciiLabel } from './designer.js';
import { Preview } from './fx.js';
import { Recorder, eventsToRawSteps, simplifySteps } from './macro-recorder.js';
import { SOUND_PRESETS, playClick } from './sound.js';

const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 9);

// ---------------------------------------------------------------- project model
function newKey(over = {}) {
  return {
    id: uid(), x: 10, y: 32, w: 96, h: 90, r: 14, label: 'Key', font: 'system-ui', fontPx: 20, fontWeight: 700,
    text: '#ffffff', labelPos: '', style: '3d', color: '#2f6fed', image: null, imageFit: 'cover',
    motion: 'push', light: 'glow', fx: '#00e5ff', ms: 260, sound: '', actions: [], ...over,
  };
}

function defaultProject() {
  const k = (label, color, actions, extra = {}) => ({ label, color, actions, ...extra });
  const c = (key, ...mods) => [{ t: 'combo', mods, key }];
  const edit = [
    k('Copy', '#2f6fed', c('c', 'ctrl')), k('Paste', '#2f6fed', c('v', 'ctrl')), k('Cut', '#2f6fed', c('x', 'ctrl')),
    k('Undo', '#7a3cf0', c('z', 'ctrl')), k('Redo', '#7a3cf0', c('y', 'ctrl')), k('Save', '#12a150', c('s', 'ctrl')),
    k('Find', '#d97706', c('f', 'ctrl')), k('Select\nall', '#d97706', c('a', 'ctrl')),
    k('👋 Hi', '#db2777', [{ t: 'text', s: 'Hello from my keypad!' }], { light: 'ripple', fx: '#ffd1e8' }),
    k('Desktop', '#334155', c('d', 'gui')), k('Lock', '#334155', c('l', 'gui')), k('Alt+Tab', '#334155', c('tab', 'alt')),
  ];
  const nav = [
    k('↑', '#15803d', c('up')), k('←', '#15803d', c('left')), k('↓', '#15803d', c('down')), k('→', '#15803d', c('right')),
    k('PgUp', '#0f766e', c('pageup')), k('PgDn', '#0f766e', c('pagedown')),
  ];
  const p = {
    version: 1, name: 'Macro Keypad', brightness: 80, statusBar: true, dim: { after: 120, level: 10 },
    idle: { effect: 'breathe', after: 20, color: '#00a6ff', speed: 40 },
    sound: { enabled: true, volume: 0.6, preset: 'mech', custom: null },
    pages: [
      { id: uid(), name: 'Edit', bg: { type: 'gradient', color: '#0b1020', color2: '#1d2550' }, keys: edit.map((o) => newKey(o)) },
      { id: uid(), name: 'Nav', bg: { type: 'gradient', color: '#101010', color2: '#203020' }, keys: nav.map((o) => newKey({ fontPx: 26, ...o })) },
    ],
  };
  layoutGrid(p.pages[0], 4, 3, 10, 6);
  layoutGrid(p.pages[1], 3, 2, 10, 6);
  return p;
}

function usableArea(project) {
  const top = project.statusBar !== false ? SCREEN.statusH : 0;
  const bottom = project.pages.length > 1 ? SCREEN.navH : 0;
  return { top, bottom: SCREEN.h - bottom };
}

function layoutGrid(page, rows, cols, margin, gap, project = state?.project) {
  const area = project ? usableArea(project) : { top: SCREEN.statusH, bottom: SCREEN.h - SCREEN.navH };
  const n = rows * cols;
  while (page.keys.length < n) page.keys.push(newKey({ label: String(page.keys.length + 1), color: '#475569' }));
  page.keys.length = n;
  const w = Math.floor((SCREEN.w - margin * 2 - gap * (cols - 1)) / cols);
  const h = Math.floor((area.bottom - area.top - margin * 2 - gap * (rows - 1)) / rows);
  page.keys.forEach((key, i) => {
    const r = Math.floor(i / cols), col = i % cols;
    Object.assign(key, { x: margin + col * (w + gap), y: area.top + margin + r * (h + gap), w, h });
  });
}

// Device config -> project (used when the keypad has no project.json yet).
function projectFromConfig(cfg) {
  const p = defaultProject();
  Object.assign(p, { name: cfg.name, brightness: cfg.brightness, statusBar: cfg.statusBar, dim: cfg.dim || p.dim, idle: cfg.idle || p.idle });
  p.pages = cfg.pages.map((pg) => ({
    id: uid(), name: pg.name,
    bg: { type: pg.bg?.color2 ? 'gradient' : 'color', color: pg.bg?.color || '#101018', color2: pg.bg?.color2 || '#303060' },
    keys: pg.keys.map((k) => newKey({ x: k.x, y: k.y, w: k.w, h: k.h, r: k.r, label: k.label, color: k.color, text: k.text, motion: k.motion, light: k.light, fx: k.fx, ms: k.ms, actions: k.actions || [], style: 'flat' })),
  }));
  return p;
}

// ---------------------------------------------------------------- storage (IndexedDB)
const db = {
  open() {
    return (this._p ??= new Promise((res, rej) => {
      const r = indexedDB.open('macro-keypad', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  },
  async get(k) {
    const d = await this.open();
    return new Promise((res) => { const r = d.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); });
  },
  async set(k, v) {
    const d = await this.open();
    return new Promise((res) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; });
  },
};

// ---------------------------------------------------------------- state
const state = {
  project: null, page: 0, key: -1, mode: 'edit', device: null, caps: [], capSig: [], bg: null, bgSig: '',
  recorder: new Recorder(), recording: false, unsaved: false, latest: null, updating: false,
};
const preview = new Preview($('screen'));
const curPage = () => state.project.pages[state.page];
const curKey = () => curPage().keys[state.key];

let saveTimer;
function changed({ visuals = true, panels = false } = {}) {
  state.unsaved = true;
  renderSaveState();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => db.set('project', state.project), 400);
  if (visuals) refreshVisuals();
  if (panels) renderPanels();
}

// ---------------------------------------------------------------- UI helpers
function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), err ? 7000 : 3000);
}
function progress(label, frac) {
  const p = $('progress');
  if (label === null) { p.hidden = true; return; }
  p.hidden = false;
  p.querySelector('.label').textContent = label;
  p.querySelector('.bar span').style.width = `${Math.round((frac || 0) * 100)}%`;
}
function seg(el, values, labels, current, onPick) {
  el.innerHTML = '';
  values.forEach((v, i) => {
    const b = document.createElement('button');
    b.textContent = labels ? labels[i] : v;
    b.dataset.v = v;
    b.classList.toggle('on', v === current);
    b.onclick = () => onPick(v);
    el.appendChild(b);
  });
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- rendering
async function refreshVisuals() {
  const page = curPage();
  const project = state.project;
  const bgSig = JSON.stringify(page.bg);
  if (bgSig !== state.bgSig) { state.bgSig = bgSig; state.bg = await renderBgCanvas(page); }
  const sigs = page.keys.map((k) => JSON.stringify([k.w, k.h, k.r, k.label, k.font, k.fontPx, k.fontWeight, k.text, k.labelPos, k.style, k.color, k.image, k.imageFit]));
  const caps = [];
  for (let i = 0; i < page.keys.length; i++) {
    const old = state.capSig.indexOf(sigs[i]);
    caps[i] = old >= 0 ? state.caps[old] : await renderCapCanvas(page.keys[i]);
  }
  if (project !== state.project || page !== curPage()) return;   // page switched meanwhile
  state.caps = caps;
  state.capSig = sigs;
  preview.set(project, state.page, caps, state.bg);
  preview.selected = state.mode === 'edit' ? state.key : -1;
}

function frame() {
  preview.idleForce = $('idlePreview').checked;
  preview.link = state.device ? state.device.kind.toUpperCase() : 'USB';
  preview.draw();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- panels
function renderPages() {
  const ul = $('pageList');
  ul.innerHTML = '';
  state.project.pages.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span></span><small>${p.keys.length} keys</small>`;
    li.firstChild.textContent = `${i + 1}. ${p.name}`;
    li.classList.toggle('on', i === state.page);
    li.onclick = () => selectPage(i);
    ul.appendChild(li);
  });
  const p = curPage();
  $('pgName').value = p.name;
  const bg = p.bg;
  seg($('bgType'), ['color', 'gradient', 'image'], ['Color', 'Gradient', 'Picture'], bg.type, (v) => { bg.type = v; changed({ panels: true }); });
  $('bgColor').value = bg.color || '#101018';
  $('bgColor2').value = bg.color2 || '#303060';
  $('bgColor2Wrap').hidden = bg.type !== 'gradient';
  $('bgImageWrap').hidden = bg.type !== 'image';
  $('bgFit').value = bg.fit || 'cover';
  $('bgDim').value = bg.dim || 0;
  $('pgDel').disabled = state.project.pages.length < 2;
}

function renderKeyForm() {
  const k = curKey();
  $('noKey').hidden = !!k;
  $('keyForm').hidden = !k;
  if (!k) return;
  $('kLabel').value = k.label;
  $('kFont').value = k.font;
  $('kFontPx').value = k.fontPx;
  $('kWeight').value = String(k.fontWeight);
  $('kText').value = k.text;
  $('kLabelPos').value = k.labelPos || '';
  $('kColor').value = k.color;
  $('kRadius').value = k.r;
  $('kImgFit').value = k.imageFit || 'cover';
  $('kImgClear').disabled = !k.image;
  for (const f of ['x', 'y', 'w', 'h']) $('k' + f.toUpperCase()).value = Math.round(k[f]);
  renderStyleSwatches(k);
}

async function renderStyleSwatches(k) {
  const box = $('kStyle');
  box.innerHTML = '';
  for (const s of STYLES) {
    const b = document.createElement('button');
    const c = document.createElement('canvas');
    c.width = 90; c.height = 60;
    b.append(c, document.createTextNode(s === '3d' ? '3D' : cap(s)));
    b.classList.toggle('on', k.style === s);
    b.onclick = () => { k.style = s; changed({ panels: true }); };
    box.appendChild(b);
    drawCap(c.getContext('2d'), { ...k, w: 90, h: 60, style: s, fontPx: 16, r: Math.min(k.r, 16) });
  }
}

function renderFx() {
  const k = curKey();
  const dis = !k;
  for (const id of ['fxColor', 'fxMs', 'fxSound', 'fxPreview', 'fxAllPage']) $(id).disabled = dis;
  seg($('fxMotion'), MOTIONS, MOTIONS.map(cap), k?.motion, (v) => { k.motion = v; changed({ panels: true }); pressPreview(); });
  seg($('fxLight'), LIGHTS, LIGHTS.map(cap), k?.light, (v) => { k.light = v; changed({ panels: true }); pressPreview(); });
  if (!k) return;
  $('fxColor').value = k.fx;
  $('fxMs').value = k.ms;
  fillSoundSelect($('fxSound'), true);
  $('fxSound').value = k.sound || '';
}

function fillSoundSelect(sel, perKey) {
  const s = state.project.sound;
  sel.innerHTML = '';
  const add = (v, t) => sel.add(new Option(t, v));
  if (perKey) add('', `Keypad default (${s.preset === 'custom' ? 'my sound' : SOUND_PRESETS[s.preset] || 'none'})`);
  for (const [v, t] of Object.entries(SOUND_PRESETS)) add(v, t);
  if (s.custom) add('custom', 'My uploaded sound');
  add('none', 'No sound');
}

function renderDevice() {
  const p = state.project;
  $('dName').value = p.name;
  $('dBright').value = p.brightness;
  $('dStatus').checked = p.statusBar !== false;
  $('dDimAfter').value = p.dim.after;
  $('dDimLevel').value = p.dim.level;
  seg($('idleEffect'), IDLES, IDLES.map(cap), p.idle.effect, (v) => { p.idle.effect = v; changed({ panels: true }); });
  $('idleAfter').value = p.idle.after;
  $('idleColor').value = p.idle.color;
  $('idleSpeed').value = p.idle.speed;
  $('sEnabled').checked = p.sound.enabled;
  fillSoundSelect($('sPreset'), false);
  $('sPreset').value = p.sound.preset;
  $('sVolume').value = p.sound.volume;
  const d = state.device;
  $('devInfo').textContent = d
    ? `Connected over ${d.kind === 'usb' ? 'USB' : 'Bluetooth'}\nFirmware ${d.info.fw} · ${d.info.board}\nTyping via: ${d.info.link.toUpperCase()}   Bluetooth: ${d.info.ble}\nStorage: ${(d.info.fsUsed / 1048576).toFixed(1)} / ${(d.info.fsTotal / 1048576).toFixed(1)} MB${d.info.frameMs !== undefined ? `\nScreen frame time: ${d.info.frameMs} ms` : ''}`
    : 'Not connected.';
  renderFirmware();
  $('dBoot').disabled = !d || d.kind !== 'usb';
  $('dReboot').disabled = !d;
}

// '1.10.0' > '1.9.0'
function cmpVer(a, b) {
  const pa = String(a || '0').split('.').map(Number), pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function renderFirmware() {
  const d = state.device, latest = state.latest;
  const btn = $('fwUpdate');
  const lv = latest?.version;
  if (state.updating) return;
  if (!d) { $('fwInfo').textContent = `Latest: ${lv || 'unknown'}\nConnect over USB to check or update.`; btn.disabled = true; btn.textContent = 'Update firmware'; return; }
  const iv = d.info.fw;
  const newer = lv && cmpVer(lv, iv) > 0;
  const legacy = cmpVer(iv, OTA_SINCE) < 0;   // firmware without in-place updates
  $('fwInfo').textContent = `Installed: ${iv}   Latest: ${lv || 'unknown'}` + (newer ? '\nA new version is available.' : '\nUp to date.');
  btn.textContent = legacy ? `Update to ${lv || OTA_SINCE} (one-time setup)` : newer ? `Update to ${lv}` : `Reinstall ${lv || ''}`.trim();
  btn.disabled = d.kind !== 'usb' || (!legacy && !latest?.app);
  btn.title = d.kind !== 'usb' ? 'Connect over USB to update' : '';
}

async function loadLatest() {
  try { state.latest = await (await fetch('fw/manifest.json', { cache: 'no-store' })).json(); } catch { state.latest = null; }
  renderFirmware();
}

const OTA_SINCE = '1.3.0';

// Keypads older than 1.3.0 can't update in place: switch them into the chip's USB flashing mode
// from software (no BOOT button) and hand over to the installer page.
async function legacyUpdate(d) {
  if (!confirm('One-time setup: the keypad switches itself into update mode and the installer opens.\n\n' +
    'Click Install firmware there and pick "USB JTAG/serial debug unit". No buttons needed.\n' +
    'This step clears the keypad\'s storage once - afterwards connect again and click Save to keypad (your design stays in this browser).')) return;
  state.device = null;   // the port goes away; don't report it as an unexpected disconnect
  setConn();
  await d.rpc('bootloader', {}, 3000).catch(() => {});
  try { await d.close(); } catch {}
  window.open('flasher.html?from=studio', '_blank');
}

async function updateFirmware() {
  const d = state.device;
  if (!d) return;
  if (cmpVer(d.info.fw, OTA_SINCE) < 0) return legacyUpdate(d);
  if (!state.latest?.app) return;
  if (!confirm(`Install firmware ${state.latest.version} on the keypad? It restarts when done; your layout is kept.`)) return;
  try {
    state.updating = true;
    progress('Downloading firmware…', 0);
    const res = await fetch(`fw/${state.latest.app.path}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (state.latest.app.size && bytes.length !== state.latest.app.size) throw new Error('download incomplete, try again');
    const t0 = performance.now();
    await d.updateFirmware(bytes, (a, b) => progress(`Installing firmware… ${Math.round((a / b) * 100)}%`, a / b));
    progress('Restarting keypad…', 1);
    console.log(`firmware upload took ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    await reconnectAfterReboot(d.link.port);
  } catch (e) {
    toast(`Update failed: ${e.message}\nThe keypad keeps running its current firmware.`, true);
  } finally {
    state.updating = false;
    progress(null);
    renderDevice();
  }
}

// After an update the keypad re-enumerates on USB; reopen the already-granted port without a picker.
async function reconnectAfterReboot(oldPort) {
  try { await state.device?.close(); } catch {}
  state.device = null;
  setConn();
  const until = Date.now() + 25000;
  await new Promise((r) => setTimeout(r, 2500));
  while (Date.now() < until) {
    const ports = (await navigator.serial.getPorts()).filter((p) => p.getInfo().usbVendorId === 0x303a);
    for (const port of [oldPort, ...ports.filter((p) => p !== oldPort)]) {
      try {
        await attach(await Device.connect('usb', port));
        toast(`Firmware updated - keypad now runs ${state.device.info.fw}`);
        return;
      } catch { /* not back yet */ }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  toast('The keypad restarted. Click USB to connect again.');
}

function renderPanels() {
  renderPages();
  renderKeyForm();
  renderSteps();
  renderFx();
  renderDevice();
  $('keyDel').disabled = $('keyDup').disabled = !curKey();
}

// ---------------------------------------------------------------- macro steps editor
function stepBody(step, li) {
  const body = li.querySelector('.body');
  const tag = (t) => { const s = document.createElement('span'); s.className = 'tag'; s.textContent = t; body.appendChild(s); };
  const save = () => changed({ visuals: false });
  if (step.t === 'combo') {
    tag('SHORTCUT');
    const mods = document.createElement('div');
    mods.className = 'mods';
    for (const m of MODS) {
      const l = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = (step.mods || []).includes(m);
      cb.onchange = () => { step.mods = MODS.filter((x) => (x === m ? cb.checked : (step.mods || []).includes(x))); save(); };
      l.append(cb, document.createTextNode(prettyKey(m)));
      mods.appendChild(l);
    }
    body.appendChild(mods);
    const sel = document.createElement('select');
    sel.add(new Option('(modifier only)', ''));
    for (const k of Object.keys(KEYS).filter((k) => !/^[lr](ctrl|shift|alt|gui)$/.test(k))) sel.add(new Option(prettyKey(k), k));
    sel.value = step.key || '';
    sel.onchange = () => { step.key = sel.value || undefined; save(); };
    body.appendChild(sel);
    const capBtn = document.createElement('button');
    capBtn.className = 'btn sm capture';
    capBtn.textContent = 'Press keys…';
    capBtn.title = 'Click, then press the shortcut on your keyboard';
    capBtn.onclick = () => captureCombo(step, capBtn);
    body.appendChild(capBtn);
  } else if (step.t === 'text') {
    tag('TEXT');
    const inp = document.createElement('input');
    inp.value = step.s;
    inp.placeholder = 'Text to type';
    inp.oninput = () => { step.s = inp.value; save(); };
    body.appendChild(inp);
  } else if (step.t === 'delay') {
    tag('PAUSE');
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = 0; inp.max = 10000; inp.value = step.ms;
    inp.oninput = () => { step.ms = Math.max(0, Math.min(10000, +inp.value || 0)); save(); };
    body.appendChild(inp);
    body.appendChild(document.createTextNode('ms'));
  } else {
    tag(step.t === 'down' ? 'KEY DOWN' : 'KEY UP');
    const sel = document.createElement('select');
    for (const k of Object.keys(KEYS)) sel.add(new Option(prettyKey(k), k));
    sel.value = step.key;
    sel.onchange = () => { step.key = sel.value; save(); };
    body.appendChild(sel);
  }
}

function captureCombo(step, btn) {
  btn.classList.add('on');
  btn.textContent = 'Listening…';
  const onKey = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const k = codeToKey(e.code);
    if (!k || /^[lr](ctrl|shift|alt|gui)$/.test(k)) return;   // wait for the non-modifier key
    step.mods = MODS.filter((m) => ({ ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, gui: e.metaKey }[m]));
    step.key = k;
    window.removeEventListener('keydown', onKey, true);
    changed({ visuals: false });
    renderSteps();
  };
  window.addEventListener('keydown', onKey, true);
}

function renderSteps() {
  const k = curKey();
  const ol = $('steps');
  ol.innerHTML = '';
  for (const id of ['addCombo', 'addText', 'addDelay', 'clearSteps', 'recBtn']) $(id).disabled = !k;
  $('testMacro').disabled = !k || !state.device;
  if (!k) return;
  const tpl = $('stepTpl');
  k.actions.forEach((step, i) => {
    const li = tpl.content.firstElementChild.cloneNode(true);
    stepBody(step, li);
    li.querySelector('.up').onclick = () => { if (i > 0) { [k.actions[i - 1], k.actions[i]] = [k.actions[i], k.actions[i - 1]]; changed({ visuals: false }); renderSteps(); } };
    li.querySelector('.down').onclick = () => { if (i < k.actions.length - 1) { [k.actions[i + 1], k.actions[i]] = [k.actions[i], k.actions[i + 1]]; changed({ visuals: false }); renderSteps(); } };
    li.querySelector('.del').onclick = () => { k.actions.splice(i, 1); changed({ visuals: false }); renderSteps(); };
    // drag to reorder
    li.draggable = true;
    li.ondragstart = (e) => { e.dataTransfer.setData('text/plain', String(i)); li.classList.add('dragging'); };
    li.ondragend = () => li.classList.remove('dragging');
    li.ondragover = (e) => e.preventDefault();
    li.ondrop = (e) => {
      e.preventDefault();
      const from = +e.dataTransfer.getData('text/plain');
      if (from === i) return;
      const [m] = k.actions.splice(from, 1);
      k.actions.splice(i, 0, m);
      changed({ visuals: false });
      renderSteps();
    };
    ol.appendChild(li);
  });
  if (!k.actions.length) {
    const li = document.createElement('li');
    li.className = 'hint';
    li.textContent = 'No steps yet - add a shortcut or text, or record your keys.';
    ol.appendChild(li);
  }
}

function toggleRecord() {
  const k = curKey();
  if (!k) return;
  const btn = $('recBtn');
  if (!state.recording) {
    state.recording = true;
    btn.classList.add('on');
    btn.textContent = '■ Stop';
    $('recLive').textContent = 'Recording… type now. Every key (even Esc) is captured until you click Stop.';
    state.recorder.onEvent = (evs) => {
      const raw = eventsToRawSteps(evs);
      $('recLive').textContent = raw.filter((s) => s.t === 'down').map((s) => prettyKey(s.key)).join(' ') || '…';
    };
    state.recorder.start();
  } else {
    state.recording = false;
    btn.classList.remove('on');
    btn.textContent = '● Record keys';
    const evs = state.recorder.stop();
    const steps = $('recTiming').checked
      ? eventsToRawSteps(evs)
      : simplifySteps(eventsToRawSteps(evs, { chars: true }), { keepPausesOver: 400 });
    k.actions.push(...steps);
    $('recLive').textContent = steps.length ? `Added ${steps.length} step(s).` : 'Nothing recorded.';
    changed({ visuals: false });
    renderSteps();
  }
}

// ---------------------------------------------------------------- selection / preview interaction
function selectPage(i) {
  state.page = Math.max(0, Math.min(i, state.project.pages.length - 1));
  state.key = curPage().keys.length ? 0 : -1;
  state.capSig = []; state.caps = []; state.bgSig = '';
  preview.anims = [];
  refreshVisuals();
  renderPanels();
  if (state.device && state.mode === 'test') state.device.rpc('page', { p: state.page }).catch(() => {});
}
function selectKey(i) {
  state.key = i;
  preview.selected = state.mode === 'edit' ? i : -1;
  renderPanels();
}

function canvasPoint(e) {
  const r = $('screen').getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * SCREEN.w, y: ((e.clientY - r.top) / r.height) * SCREEN.h };
}
function hitKey(x, y) {
  const keys = curPage().keys;
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i];
    if (x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + k.h) return i;
  }
  return -1;
}

function soundFor(k) {
  const s = state.project.sound;
  if (!s.enabled) return null;
  let v = k?.sound || s.preset;
  if (v === 'custom') v = s.custom;
  return v;
}

function pressPreview() {
  const k = curKey();
  if (!k) return;
  preview.press(state.key, k.x + k.w / 2, k.y + k.h / 2);
  playClick(soundFor(k), state.project.sound.volume);
  setTimeout(() => preview.release(), 160);
}

let drag = null;
$('screen').addEventListener('pointerdown', (e) => {
  const { x, y } = canvasPoint(e);
  preview.touch();
  if (state.mode === 'test') {
    if (state.project.pages.length > 1 && y >= SCREEN.h - SCREEN.navH) {
      const n = state.project.pages.length;
      if (x < 90) selectPage((state.page + n - 1) % n);
      else if (x > SCREEN.w - 90) selectPage((state.page + 1) % n);
      return;
    }
    const i = hitKey(x, y);
    if (i >= 0) {
      preview.press(i, x, y);
      playClick(soundFor(curPage().keys[i]), state.project.sound.volume);
    }
    return;
  }
  const i = hitKey(x, y);
  if (i < 0) { selectKey(-1); return; }
  selectKey(i);
  const k = curKey();
  const resize = x > k.x + k.w - 14 && y > k.y + k.h - 14;
  drag = { i, resize, x0: x, y0: y, k0: { ...k } };
  $('screen').setPointerCapture(e.pointerId);
});
$('screen').addEventListener('pointermove', (e) => {
  if (!drag) return;
  const { x, y } = canvasPoint(e);
  const k = curPage().keys[drag.i];
  const snap = (v) => Math.round(v / 2) * 2;
  if (drag.resize) {
    k.w = Math.max(16, Math.min(SCREEN.w - k.x, snap(drag.k0.w + x - drag.x0)));
    k.h = Math.max(16, Math.min(SCREEN.h - k.y, snap(drag.k0.h + y - drag.y0)));
  } else {
    k.x = Math.max(0, Math.min(SCREEN.w - k.w, snap(drag.k0.x + x - drag.x0)));
    k.y = Math.max(0, Math.min(SCREEN.h - k.h, snap(drag.k0.y + y - drag.y0)));
  }
  if (drag.resize) refreshVisuals();
  for (const f of ['x', 'y', 'w', 'h']) $('k' + f.toUpperCase()).value = Math.round(k[f]);
});
const endDrag = () => {
  if (state.mode === 'test') { preview.release(); return; }
  if (drag) { drag = null; changed(); }
};
$('screen').addEventListener('pointerup', endDrag);
$('screen').addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------- device link
// Save button shows whether the keypad has this exact design: orange dot = unsaved, green = saved.
function renderSaveState() {
  const b = $('btnSave');
  const synced = !!state.device && !state.unsaved;
  b.classList.toggle('dirty', state.unsaved);
  b.classList.toggle('synced', synced);
  b.textContent = synced ? 'Saved ✓' : 'Save to keypad';
}

// Compare the keypad's saved design fingerprint with this browser's design.
async function checkSync(d) {
  try {
    const files = (await d.list()).map((f) => f.n);
    let onKeypad = null;
    if (files.includes('/config.json')) onKeypad = JSON.parse(new TextDecoder().decode(await d.readFile('config.json'))).design || null;
    if (state.device !== d) return;
    state.unsaved = onKeypad !== designHash(state.project);
  } catch { /* leave as is */ }
  renderSaveState();
}

function setConn() {
  const d = state.device;
  const chip = $('connState');
  chip.className = 'chip ' + (d ? d.kind : 'off');
  chip.textContent = d ? `${d.kind === 'usb' ? 'USB' : 'Bluetooth'} · fw ${d.info.fw}` : 'Not connected';
  $('btnUsb').hidden = $('btnBle').hidden = !!d;
  $('btnDisconnect').hidden = !d;
  $('btnLoad').disabled = $('btnSave').disabled = !d;
  renderSaveState();
  renderDevice();
  renderSteps();
}

async function attach(d) {
  state.device = d;
  d.onEvent = onDeviceEvent;
  d.onClose = () => { if (state.device !== d) return; state.device = null; setConn(); if (!state.updating) toast('Keypad disconnected'); };
  setConn();
  checkSync(d);
}

async function connect(kind) {
  try {
    const d = await Device.connect(kind);
    await attach(d);
    const newer = state.latest?.version && cmpVer(state.latest.version, d.info.fw) > 0;
    toast(`Connected to ${d.info.board} over ${kind === 'usb' ? 'USB' : 'Bluetooth'}` +
      (newer ? `\nFirmware ${state.latest.version} is available - see the Keypad tab.` : ''));
  } catch (e) {
    if (e.name !== 'NotFoundError') toast(`Could not connect: ${e.message}`, true);
  }
}

function onDeviceEvent(ev) {
  if (ev.ev === 'press') {
    const page = state.project.pages[ev.p];
    const k = page?.keys[ev.k];
    playClick(soundFor(k), state.project.sound.volume);
    if (ev.p === state.page && k) {
      preview.press(ev.k, k.x + k.w / 2, k.y + k.h / 2);
      setTimeout(() => preview.release(), 150);
    }
  } else if (ev.ev === 'page' && state.mode === 'test' && ev.p !== state.page) {
    selectPage(ev.p);
  }
}

async function saveToDevice() {
  const d = state.device;
  if (!d) return;
  try {
    progress('Preparing keycaps…', 0);
    const { config, files } = await compileProject(state.project);
    const errs = validateConfig(config);
    if (errs.length) throw new Error(errs.slice(0, 6).join('\n'));
    const cfgBytes = new TextEncoder().encode(JSON.stringify(config));
    if (d.kind === 'ble') {
      progress('Sending layout over Bluetooth…', 0.2);
      await d.writeFile('config.json', cfgBytes, (a, b) => progress('Sending layout over Bluetooth…', a / b));
      await d.apply();
      state.unsaved = designHash(state.project) !== config.design;
      renderSaveState();
      toast('Saved layout and macros.\nPictures and keycap designs are only sent over USB - the keypad shows plain keys until you save over USB.');
      return;
    }
    const existing = new Map((await d.list()).map((f) => [f.n.replace(/^\//, ''), f.s]));
    const todo = [...files].filter(([n, b]) => existing.get(n) !== b.length);
    const projBytes = new TextEncoder().encode(JSON.stringify(state.project));
    const total = todo.reduce((s, [, b]) => s + b.length, 0) + cfgBytes.length + projBytes.length;
    let done = 0;
    const step = (label) => (a) => progress(label, (done + a) / total);
    for (const [name, bytes] of todo) {
      await d.writeFile(name, bytes, step(`Uploading pictures (${todo.indexOf(todo.find(([n]) => n === name)) + 1}/${todo.length})…`));
      done += bytes.length;
    }
    await d.writeFile('project.json', projBytes, step('Saving design…'));
    done += projBytes.length;
    await d.writeFile('config.json', cfgBytes, step('Saving layout…'));
    progress('Applying…', 1);
    await d.apply();
    // remove pictures no longer used
    for (const n of existing.keys()) if (n.startsWith('img/') && !files.has(n)) await d.remove(n).catch(() => {});
    d.info = await d.rpc('hello');
    state.unsaved = designHash(state.project) !== config.design;   // still dirty if edited during the upload
    renderSaveState();
    renderDevice();
    toast(`Saved to keypad (${todo.length} new picture${todo.length === 1 ? '' : 's'}).`);
  } catch (e) {
    toast(`Save failed: ${e.message}`, true);
  } finally {
    progress(null);
  }
}

async function loadFromDevice() {
  const d = state.device;
  if (!d) return;
  if (state.unsaved && !confirm('Replace your current design with the one on the keypad?')) return;
  try {
    progress('Reading from keypad…', 0.3);
    const files = (await d.list()).map((f) => f.n);
    let project;
    if (files.includes('/project.json')) {
      project = JSON.parse(new TextDecoder().decode(await d.readFile('project.json')));
    } else if (files.includes('/config.json')) {
      project = projectFromConfig(JSON.parse(new TextDecoder().decode(await d.readFile('config.json'))));
    } else {
      toast('The keypad still has its built-in layout. Design one here and Save.');
      return;
    }
    setProject(project);
    state.unsaved = false;
    renderSaveState();
    toast('Loaded design from keypad');
  } catch (e) {
    toast(`Load failed: ${e.message}`, true);
  } finally {
    progress(null);
  }
}

// ---------------------------------------------------------------- wiring
function bindInput(id, fn, ev = 'input') { $(id).addEventListener(ev, (e) => fn(e.target)); }

function wire() {
  $('btnUsb').onclick = () => connect('usb');
  $('btnBle').onclick = () => connect('ble');
  $('btnDisconnect').onclick = async () => { await state.device?.close(); state.device = null; setConn(); };
  $('btnSave').onclick = saveToDevice;
  $('btnLoad').onclick = loadFromDevice;
  $('btnExport').onclick = () => {
    const blob = new Blob([JSON.stringify(state.project, null, 1)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${asciiLabel(state.project.name) || 'keypad'}.keypad.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('btnImport').onclick = () => $('fileImport').click();
  $('fileImport').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      if (!Array.isArray(p.pages)) throw new Error('not a keypad project');
      setProject(p.version ? p : projectFromConfig(p));
      changed();
      toast('Project imported');
    } catch (err) { toast(`Import failed: ${err.message}`, true); }
    e.target.value = '';
  };

  // pages
  $('pgAdd').onclick = () => {
    const p = { id: uid(), name: `Page ${state.project.pages.length + 1}`, bg: clone(curPage().bg), keys: [] };
    state.project.pages.push(p);
    layoutGrid(p, 4, 3, 10, 6);
    selectPage(state.project.pages.length - 1);
    changed({ panels: true });
  };
  $('pgDup').onclick = () => {
    const p = clone(curPage());
    p.id = uid(); p.name += ' copy'; p.keys.forEach((k) => (k.id = uid()));
    state.project.pages.splice(state.page + 1, 0, p);
    selectPage(state.page + 1);
    changed({ panels: true });
  };
  $('pgDel').onclick = () => {
    if (state.project.pages.length < 2 || !confirm(`Delete page "${curPage().name}"?`)) return;
    state.project.pages.splice(state.page, 1);
    selectPage(Math.min(state.page, state.project.pages.length - 1));
    changed({ panels: true });
  };
  const movePage = (d) => {
    const ps = state.project.pages, j = state.page + d;
    if (j < 0 || j >= ps.length) return;
    [ps[j], ps[state.page]] = [ps[state.page], ps[j]];
    state.page = j;
    changed({ panels: true });
  };
  $('pgUp').onclick = () => movePage(-1);
  $('pgDown').onclick = () => movePage(1);
  bindInput('pgName', (t) => { curPage().name = t.value; changed({ visuals: false }); renderPages(); });
  bindInput('bgColor', (t) => { curPage().bg.color = t.value; changed(); });
  bindInput('bgColor2', (t) => { curPage().bg.color2 = t.value; changed(); });
  bindInput('bgFit', (t) => { curPage().bg.fit = t.value; changed(); }, 'change');
  bindInput('bgDim', (t) => { curPage().bg.dim = +t.value; changed(); });
  $('bgPick').onclick = () => $('bgFile').click();
  $('bgClear').onclick = () => { curPage().bg.image = null; changed(); };
  $('bgFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    curPage().bg.image = await importImage(f, 960);
    curPage().bg.type = 'image';
    changed({ panels: true });
    e.target.value = '';
  };
  $('grApply').onclick = () => {
    layoutGrid(curPage(), +$('grRows').value || 1, +$('grCols').value || 1, +$('grMargin').value || 0, +$('grGap').value || 0);
    state.key = Math.min(state.key, curPage().keys.length - 1);
    changed({ panels: true });
  };

  // mode + keys
  seg($('mode'), ['edit', 'test'], ['Design', 'Try it'], 'edit', setMode);
  $('keyAdd').onclick = () => {
    const keys = curPage().keys;
    const top = usableArea(state.project).top + 10;
    keys.push(newKey({ x: 112, y: top, label: `Key ${keys.length + 1}` }));
    selectKey(keys.length - 1);
    changed();
  };
  $('keyDup').onclick = () => {
    const k = curKey();
    if (!k) return;
    const c = { ...clone(k), id: uid(), x: Math.min(SCREEN.w - k.w, k.x + 12), y: Math.min(SCREEN.h - k.h, k.y + 12) };
    curPage().keys.push(c);
    selectKey(curPage().keys.length - 1);
    changed();
  };
  $('keyDel').onclick = () => {
    if (!curKey()) return;
    curPage().keys.splice(state.key, 1);
    selectKey(Math.min(state.key, curPage().keys.length - 1));
    changed();
  };

  // tabs
  for (const b of $('tabs').children) {
    b.onclick = () => {
      for (const x of $('tabs').children) x.classList.toggle('on', x === b);
      for (const t of document.querySelectorAll('.tab')) t.hidden = t.dataset.tab !== b.dataset.tab;
    };
  }

  // key form
  for (const f of FONTS) $('kFont').add(new Option(f, f));
  const kset = (prop, conv = (v) => v, ev = 'input') => (id) => bindInput(id, (t) => { const k = curKey(); if (!k) return; k[prop] = conv(t.value); changed(); if (['style', 'color', 'r', 'image'].includes(prop)) renderStyleSwatches(k); }, ev);
  kset('label')('kLabel');
  kset('font', String, 'change')('kFont');
  kset('fontPx', Number)('kFontPx');
  kset('fontWeight', Number, 'change')('kWeight');
  kset('text')('kText');
  kset('labelPos', String, 'change')('kLabelPos');
  kset('color')('kColor');
  kset('r', Number)('kRadius');
  kset('imageFit', String, 'change')('kImgFit');
  for (const f of ['x', 'y', 'w', 'h']) {
    bindInput('k' + f.toUpperCase(), (t) => {
      const k = curKey();
      if (!k) return;
      const lim = f === 'x' || f === 'w' ? SCREEN.w : SCREEN.h;
      k[f] = Math.max(f === 'w' || f === 'h' ? 8 : 0, Math.min(lim, +t.value || 0));
      if (k.x + k.w > SCREEN.w) k.x = SCREEN.w - k.w;
      if (k.y + k.h > SCREEN.h) k.y = SCREEN.h - k.h;
      changed();
    }, 'change');
  }
  $('kImgPick').onclick = () => $('kImgFile').click();
  $('kImgClear').onclick = () => { const k = curKey(); if (k) { k.image = null; changed({ panels: true }); } };
  $('kImgFile').onchange = async (e) => {
    const f = e.target.files[0], k = curKey();
    if (!f || !k) return;
    k.image = await importImage(f, 400);
    if (k.style !== 'image' && k.imageFit !== 'icon') k.style = 'image';
    changed({ panels: true });
    e.target.value = '';
  };

  // macro
  const addStep = (s) => { const k = curKey(); if (!k) return; k.actions.push(s); changed({ visuals: false }); renderSteps(); };
  $('addCombo').onclick = () => addStep({ t: 'combo', mods: ['ctrl'], key: 'c' });
  $('addText').onclick = () => addStep({ t: 'text', s: '' });
  $('addDelay').onclick = () => addStep({ t: 'delay', ms: 100 });
  $('clearSteps').onclick = () => { const k = curKey(); if (k && confirm('Remove all steps of this key?')) { k.actions = []; changed({ visuals: false }); renderSteps(); } };
  $('recBtn').onclick = toggleRecord;
  $('testMacro').onclick = async () => {
    const k = curKey();
    if (!k || !state.device) return;
    try {
      toast('Running in 2 s - click into the window where it should type…');
      await new Promise((r) => setTimeout(r, 2000));
      await state.device.rpc('run', { actions: k.actions });
    } catch (e) { toast(`Run failed: ${e.message}`, true); }
  };

  // fx
  bindInput('fxColor', (t) => { const k = curKey(); if (k) { k.fx = t.value; changed({ visuals: false }); } });
  bindInput('fxMs', (t) => { const k = curKey(); if (k) { k.ms = +t.value; changed({ visuals: false }); } });
  $('fxMs').addEventListener('change', pressPreview);
  bindInput('fxSound', (t) => { const k = curKey(); if (k) { k.sound = t.value; changed({ visuals: false }); pressPreview(); } }, 'change');
  $('fxPreview').onclick = pressPreview;
  $('fxAllPage').onclick = () => {
    const k = curKey();
    if (!k) return;
    for (const o of curPage().keys) Object.assign(o, { motion: k.motion, light: k.light, fx: k.fx, ms: k.ms, sound: k.sound });
    changed({ visuals: false });
    toast('Applied to every key on this page');
  };

  // device tab
  bindInput('dName', (t) => { state.project.name = t.value; changed({ visuals: false }); });
  bindInput('dBright', (t) => {
    state.project.brightness = +t.value;
    changed({ visuals: false });
    state.device?.rpc('bright', { v: +t.value }).catch(() => {});
  });
  bindInput('dStatus', (t) => { state.project.statusBar = t.checked; changed(); }, 'change');
  bindInput('dDimAfter', (t) => { state.project.dim.after = Math.max(0, +t.value || 0); changed({ visuals: false }); });
  bindInput('dDimLevel', (t) => { state.project.dim.level = Math.max(0, Math.min(100, +t.value || 0)); changed({ visuals: false }); });
  bindInput('idleAfter', (t) => { state.project.idle.after = Math.max(1, +t.value || 1); changed({ visuals: false }); });
  bindInput('idleColor', (t) => { state.project.idle.color = t.value; changed({ visuals: false }); });
  bindInput('idleSpeed', (t) => { state.project.idle.speed = +t.value; changed({ visuals: false }); });
  bindInput('sEnabled', (t) => { state.project.sound.enabled = t.checked; changed({ visuals: false }); }, 'change');
  bindInput('sPreset', (t) => { state.project.sound.preset = t.value; changed({ visuals: false }); renderFx(); playClick(soundFor(null), state.project.sound.volume); }, 'change');
  bindInput('sVolume', (t) => { state.project.sound.volume = +t.value; changed({ visuals: false }); });
  $('sVolume').addEventListener('change', () => playClick(soundFor(null), state.project.sound.volume));
  $('sTest').onclick = () => playClick(soundFor(null) || 'mech', state.project.sound.volume);
  $('sUpload').onclick = () => $('sFile').click();
  $('sFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 400 * 1024) { toast('Please pick a short sound (under 400 KB).', true); return; }
    state.project.sound.custom = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
    state.project.sound.preset = 'custom';
    changed({ visuals: false, panels: true });
    playClick(soundFor(null), state.project.sound.volume);
    e.target.value = '';
  };
  $('dBoot').onclick = async () => {
    if (!confirm('Restart the keypad into firmware update mode? It stops working as a keypad until you flash firmware or press RESET.')) return;
    await state.device.rpc('bootloader').catch(() => {});
    window.open('flasher.html', '_blank');
  };
  $('dReboot').onclick = () => state.device?.rpc('reboot').catch(() => {});
  $('fwUpdate').onclick = updateFirmware;

  window.addEventListener('beforeunload', (e) => { if (state.unsaved && state.device) { e.preventDefault(); e.returnValue = ''; } });
}

function setMode(m) {
  state.mode = m;
  seg($('mode'), ['edit', 'test'], ['Design', 'Try it'], m, setMode);
  preview.selected = m === 'edit' ? state.key : -1;
  $('stageHint').textContent = m === 'edit'
    ? 'Click a key to edit it. Drag to move, drag the white corner to resize.'
    : 'Tap keys to see the motion, light and click sound. Use the page bar to switch pages.';
}

function setProject(p) {
  // fill gaps from older files
  const d = defaultProject();
  p.dim ??= d.dim; p.idle ??= d.idle; p.sound ??= d.sound;
  for (const pg of p.pages) { pg.id ??= uid(); pg.bg ??= { type: 'color', color: '#101018' }; pg.keys = pg.keys.map((k) => newKey(k)); }
  state.project = p;
  state.page = 0;
  state.key = p.pages[0].keys.length ? 0 : -1;
  state.capSig = []; state.bgSig = '';
  db.set('project', p);
  refreshVisuals();
  renderPanels();
}

async function init() {
  const unsupported = !SerialLink.supported() && !BleLink.supported();
  if (unsupported) {
    $('banner').hidden = false;
    $('banner').textContent = 'This browser cannot talk to the keypad. Use Chrome or Edge on a computer to connect over USB or Bluetooth. You can still design and export here.';
  }
  $('btnUsb').disabled = !SerialLink.supported();
  $('btnBle').disabled = !BleLink.supported();
  wire();
  const saved = await db.get('project').catch(() => null);
  setProject(saved || defaultProject());
  state.unsaved = false;
  renderSaveState();
  requestAnimationFrame(frame);
  loadLatest();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
