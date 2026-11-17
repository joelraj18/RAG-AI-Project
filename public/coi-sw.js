// Cross-origin isolation for hosts that cannot set response headers (GitHub Pages).
// The local models (embeddings, reranker, in-browser LLM) run several times faster on several
// threads, and browsers only allow that on a cross-origin isolated page. This service worker adds
// the COOP/COEP headers to this site's own responses; it never touches requests to other sites
// (model downloads, LLM APIs) and caches nothing. Remove it by opening the app with ?coi=0.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (new URL(req.url).origin !== self.location.origin) return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  event.respondWith(
    fetch(req).then((res) => {
      if (res.status === 0 || res.type === 'opaque') return res;
      const headers = new Headers(res.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      headers.set('Cross-Origin-Resource-Policy', 'same-origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    })
  );
});
