// Multi-threaded local models need a cross-origin isolated page. Hosts that send the COOP/COEP
// headers (the Hugging Face Space, the dev and preview servers) are isolated already; on GitHub
// Pages a small service worker (public/coi-sw.js) adds them from the next page load on.

/** Whether the service worker should be registered (pure, so it can be tested). */
export function wantsIsolationWorker({ prod, isolated, hasServiceWorker, secure, topLevel, optOut }) {
  return !!(prod && !isolated && hasServiceWorker && secure && topLevel && !optOut);
}

export function setupIsolation() {
  if (typeof window === 'undefined') return;
  const optOut = new URLSearchParams(location.search).get('coi') === '0';
  const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
  if (optOut && sw) {
    sw.getRegistrations().then((regs) => regs.forEach((r) => (r.active || r.waiting || r.installing)?.scriptURL.endsWith('coi-sw.js') && r.unregister()));
    return;
  }
  const want = wantsIsolationWorker({ prod: import.meta.env.PROD, isolated: window.crossOriginIsolated, hasServiceWorker: !!sw, secure: window.isSecureContext, topLevel: window.top === window.self, optOut });
  if (want) sw.register('./coi-sw.js').catch(() => {});
}
