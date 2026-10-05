// Isolated so tests (which have no Worker and can't parse import.meta) can mock it.

export function createScanWorker() {
    if (typeof Worker === 'undefined') return null;
    return new Worker(new URL('./scan.worker.js', import.meta.url));
}
