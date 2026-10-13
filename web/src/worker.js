// Cloudflare Worker for Macro Keypad Studio: serves the static app + firmware and a tiny version API.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/version') {
      return Response.json({ app: env.APP_VERSION || 'dev', commit: env.GIT_COMMIT || 'local' });
    }
    const res = await env.ASSETS.fetch(request);
    if (url.pathname.startsWith('/fw/')) {
      const h = new Headers(res.headers);
      h.set('Cache-Control', 'no-cache');
      return new Response(res.body, { status: res.status, headers: h });
    }
    return res;
  },
};
