/**
 * Wrap a model loader so that concurrent requests for the same key share one load. A preload and
 * the first question often arrive together; without this the worker would load the model twice
 * (twice the download and memory). A failed load is forgotten, so the next request retries.
 */
export function loadOnce(loader) {
  let current = null;
  return (key, ...args) => {
    if (current?.key === key) return current.ready;
    const ready = Promise.resolve().then(() => loader(key, ...args));
    current = { key, ready };
    ready.catch(() => {
      if (current?.ready === ready) current = null;
    });
    return ready;
  };
}
