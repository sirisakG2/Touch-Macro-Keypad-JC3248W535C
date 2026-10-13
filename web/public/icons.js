// Icon library for keycaps: Lucide (https://lucide.dev, ISC License). Data is generated into
// icons/lucide.json by scripts/gen-icons.mjs and fetched only when needed.

let data = null, pending = null;

export function loadIcons() {
  if (data) return Promise.resolve(data);
  pending ??= fetch(new URL('icons/lucide.json', import.meta.url))
    .then((r) => r.json())
    .then((d) => (data = d));
  return pending;
}
export const iconsReady = () => !!data;
// For tests / node: inject already-loaded data.
export function setIconData(d) { data = d; }

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// 24x24 Lucide line icon as an SVG string in the given colour (null when unknown / not loaded).
export function iconSvg(name, color = '#ffffff', strokeWidth = 2, size = 24) {
  const nodes = data?.icons[name];
  if (!nodes) return null;
  const body = nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${esc(color)}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
export const iconDataUrl = (name, color, sw) => {
  const s = iconSvg(name, color, sw, 96);
  return s ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}` : null;
};

// Curated groups for the icon table; "All" lists everything.
export const ICON_GROUPS = {
  Popular: ['copy', 'clipboard-paste', 'scissors', 'undo-2', 'redo-2', 'save', 'search', 'lock', 'lock-open', 'house', 'monitor', 'play', 'pause',
    'skip-forward', 'skip-back', 'volume-2', 'volume-x', 'mic', 'mic-off', 'camera', 'video', 'settings', 'power', 'terminal', 'code', 'mail',
    'message-circle', 'globe', 'folder', 'image', 'music', 'star', 'heart', 'zap', 'trash', 'refresh-cw', 'download', 'upload', 'printer',
    'calendar', 'clock', 'sun', 'moon', 'bell', 'keyboard', 'mouse', 'layout-grid', 'rocket', 'bot', 'sparkles', 'coffee', 'gamepad-2'],
  Edit: ['copy', 'copy-plus', 'clipboard-paste', 'clipboard', 'scissors', 'undo-2', 'redo-2', 'rotate-ccw', 'rotate-cw', 'save', 'search', 'replace',
    'pen', 'pencil', 'eraser', 'type', 'bold', 'italic', 'underline', 'list', 'text-select', 'crop', 'layers', 'palette', 'brush', 'wand-sparkles'],
  Media: ['play', 'pause', 'square', 'skip-forward', 'skip-back', 'fast-forward', 'rewind', 'repeat', 'shuffle', 'volume', 'volume-1', 'volume-2',
    'volume-x', 'mic', 'mic-off', 'headphones', 'speaker', 'music', 'film', 'video', 'video-off', 'camera', 'camera-off', 'radio', 'tv', 'cast'],
  Arrows: ['arrow-up', 'arrow-down', 'arrow-left', 'arrow-right', 'chevron-up', 'chevron-down', 'chevron-left', 'chevron-right', 'chevrons-up',
    'chevrons-down', 'chevrons-left', 'chevrons-right', 'corner-down-left', 'arrow-big-up', 'move', 'maximize', 'minimize', 'expand', 'shrink',
    'arrow-up-down', 'arrow-left-right', 'refresh-cw', 'log-in', 'log-out'],
  System: ['power', 'settings', 'sliders-horizontal', 'toggle-left', 'toggle-right', 'lock', 'lock-open', 'key', 'shield', 'eye', 'eye-off', 'monitor',
    'monitor-up', 'laptop', 'cpu', 'hard-drive', 'database', 'battery', 'battery-charging', 'wifi', 'wifi-off', 'bluetooth', 'usb', 'command',
    'option', 'keyboard', 'mouse', 'terminal', 'square-terminal', 'app-window', 'layout-grid', 'screen-share', 'printer', 'bug', 'git-branch'],
  Communication: ['mail', 'send', 'reply', 'message-circle', 'message-square', 'phone', 'phone-off', 'video', 'users', 'user', 'at-sign',
    'share-2', 'link', 'paperclip', 'bell', 'bell-off', 'globe', 'rss', 'thumbs-up', 'thumbs-down', 'hand'],
  Files: ['file', 'file-text', 'file-plus', 'folder', 'folder-open', 'folder-plus', 'archive', 'inbox', 'download', 'upload', 'cloud', 'cloud-upload',
    'cloud-download', 'bookmark', 'tag', 'image', 'calculator', 'calendar', 'clock', 'map-pin', 'navigation'],
  Fun: ['star', 'heart', 'flame', 'zap', 'sparkles', 'rocket', 'bot', 'brain', 'gamepad-2', 'joystick', 'coffee', 'pizza', 'trophy', 'crown',
    'gift', 'party-popper', 'sun', 'moon', 'cloud-rain', 'snowflake', 'leaf', 'cat', 'dog', 'ghost', 'skull'],
};

// Names matching a search (name or Lucide tags) inside a group ('All' = every icon).
export function searchIcons(query = '', group = 'All') {
  if (!data) return [];
  const all = Object.keys(data.icons);
  const pool = group === 'All' ? all : (ICON_GROUPS[group] || []).filter((n) => data.icons[n]);
  const q = query.trim().toLowerCase();
  if (!q) return pool;
  const words = q.split(/\s+/);
  const scored = [];
  for (const n of (group === 'All' ? all : pool)) {
    const hay = `${n.replace(/-/g, ' ')} ${data.tags[n] || ''}`;
    if (!words.every((w) => hay.includes(w))) continue;
    scored.push([n.startsWith(q) ? 0 : n.includes(q) ? 1 : 2, n]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])).map((x) => x[1]);
}
