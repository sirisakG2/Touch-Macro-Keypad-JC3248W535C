// Generates web/public/icons/lucide.json (icon table for the studio) from the Lucide icon set.
// Lucide - https://lucide.dev - ISC License, Copyright (c) Lucide Icons and Contributors.
// Usage: npm run icons   (downloads the pinned lucide-static package once, outside node_modules)
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.48.0';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'lucide-'));
execSync(`npm pack lucide-static@${VERSION} --silent`, { cwd: tmp, stdio: ['ignore', 'pipe', 'inherit'] });
execSync(`tar xzf lucide-static-${VERSION}.tgz package/icon-nodes.json package/tags.json package/LICENSE`, { cwd: tmp });
const nodes = JSON.parse(readFileSync(join(tmp, 'package/icon-nodes.json'), 'utf8'));
const tags = JSON.parse(readFileSync(join(tmp, 'package/tags.json'), 'utf8'));
const license = readFileSync(join(tmp, 'package/LICENSE'), 'utf8').trim();

// Compact: drop "key" attributes, keep element name + drawing attributes.
const icons = {};
for (const [name, list] of Object.entries(nodes)) {
  icons[name] = list.map(([tag, attrs]) => {
    const a = { ...attrs };
    delete a.key;
    return [tag, a];
  });
}
const tagText = Object.fromEntries(Object.entries(tags).map(([n, t]) => [n, t.join(' ')]));
const out = { source: `lucide-static@${VERSION} (https://lucide.dev)`, license, icons, tags: tagText };
mkdirSync(join(root, 'web/public/icons'), { recursive: true });
writeFileSync(join(root, 'web/public/icons/lucide.json'), JSON.stringify(out));
console.log(`wrote ${Object.keys(icons).length} icons`);
