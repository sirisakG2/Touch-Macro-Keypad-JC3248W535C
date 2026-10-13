// Shows the deployed GitHub commit (from the Worker's /api/version) next to the page title.
const REPO = 'https://github.com/sirisakG2/Touch-Macro-Keypad-JC3248W535C';
fetch('/api/version', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : null))
  .then((v) => {
    const sha = v?.commit;
    if (!sha || sha === 'local') return;
    const el = document.getElementById('appVer');
    if (el) {
      const a = Object.assign(document.createElement('a'), { href: `${REPO}/commit/${sha}`, target: '_blank', rel: 'noopener', textContent: `build ${sha}`.toLowerCase(), title: 'Deployed GitHub commit' });
      el.replaceChildren(a);
      el.hidden = false;
    }
    document.title = `${document.title} · ${sha}`;
  })
  .catch(() => {});
