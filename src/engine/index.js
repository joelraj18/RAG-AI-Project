// Public entry point: analyse a CSV File of any size using every CPU core.
//
//   const job = startAnalysis(file, { onProgress });
//   const analysis = await job.promise;   // job.cancel() aborts
//
// Progress events: { phase: 'reading' | 'scanning' | 'finalising', bytesDone, bytesTotal, rows,
//                    estimatedRows, workers, exact, elapsedMs, estimatedMs }

import { finalize } from './finalize';
import { mergePartials } from './merge';
import { buildPlan, sniff, splitRanges } from './plan';
import { scanRange, transferables } from './scanner';
import { createScanWorker } from './workerFactory';

export { ANALYSIS_VERSION, HISTOGRAM_OPTIONS, PERCENTILES, STRONG_CORRELATION, dayToIso, pairKey } from './finalize';

export class AnalysisCancelled extends Error {
    constructor() {
        super('Analysis cancelled.');
        this.name = 'AnalysisCancelled';
    }
}

const EXPECTED_BYTES_PER_MS_PER_CORE = 20_000;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function startAnalysis(file, { onProgress = () => {}, forceMode, maxWorkers } = {}) {
    let cancelled = false;
    const workers = [];
    const pending = new Set();

    const cancel = () => {
        cancelled = true;
        workers.forEach((w) => w.terminate());
        pending.forEach((reject) => reject(new AnalysisCancelled()));
        pending.clear();
    };

    const run = (worker, message, transfer, onMessage) =>
        new Promise((resolve, reject) => {
            pending.add(reject);
            const done = () => pending.delete(reject);
            worker.onmessage = ({ data }) => {
                if (data.type === 'progress') onMessage?.(data);
                else if (data.type === 'error') {
                    done();
                    reject(new Error(data.message));
                } else {
                    done();
                    resolve(data.partial || data.analysis);
                }
            };
            worker.onerror = (event) => {
                done();
                reject(new Error(event.message || 'A background worker failed (the file may be too large for this device’s memory).'));
            };
            worker.postMessage(message, transfer || []);
        });

    const promise = (async () => {
        const started = now();
        onProgress({ phase: 'reading', bytesDone: 0, bytesTotal: file.size, rows: 0, elapsedMs: 0 });

        const sniffed = await sniff(file);
        if (cancelled) throw new AnalysisCancelled();

        const firstWorker = createScanWorker();
        const hardware = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
        const cores = firstWorker ? Math.min(maxWorkers || 8, hardware) : 1;
        const plan = buildPlan(sniffed, file.size, { cores, forceMode });
        const ranges = splitRanges(plan);
        const bytesTotal = Math.max(1, file.size - plan.dataStart);

        // First guess (measured in Chrome: ~20 MB/s per core), replaced by live rates once workers report.
        const estimatedMs = 400 + bytesTotal / (EXPECTED_BYTES_PER_MS_PER_CORE * ranges.length ** 0.9);
        const progress = ranges.map(() => ({ bytesDone: 0, rows: 0 }));
        const emit = (phase = 'scanning') =>
            onProgress({
                phase,
                bytesDone: progress.reduce((a, p) => a + p.bytesDone, 0),
                bytesTotal,
                rows: progress.reduce((a, p) => a + p.rows, 0),
                estimatedRows: plan.estimatedRows,
                workers: ranges.length,
                exact: plan.exact,
                elapsedMs: now() - started,
                estimatedMs,
            });
        emit();

        let partials;
        if (firstWorker) {
            workers.push(firstWorker);
            while (workers.length < ranges.length) workers.push(createScanWorker());
            partials = await Promise.all(
                ranges.map((range, i) =>
                    run(workers[i], { type: 'scan', file, range, plan }, null, (p) => {
                        progress[i] = p;
                        emit();
                    }),
                ),
            );
        } else {
            // No Worker support (tests, very old browsers): scan the ranges one by one on this thread.
            const isCancelled = () => cancelled;
            const reporter = (index) => (p) => {
                progress[index] = p;
                emit();
            };
            partials = [];
            for (const range of ranges) partials.push(await scanRange(file, range, plan, reporter(range.index), isCancelled));
        }
        if (cancelled) throw new AnalysisCancelled();
        partials.forEach((p, i) => (progress[i] = { bytesDone: progress[i].bytesDone, rows: p.rows }));

        const rows = partials.reduce((a, p) => a + p.rows, 0);
        if (rows === 0) throw new Error('That file has no data rows.');
        emit('finalising');

        const meta = { fileName: file.name, fileSize: file.size, workers: ranges.length, mode: plan.exact ? 'exact' : 'streaming' };
        const analysis = firstWorker
            ? await run(workers[0], { type: 'finalize', partials, plan, meta }, transferables(partials))
            : finalize(mergePartials(partials, plan), plan, meta);
        analysis.meta.elapsedMs = now() - started;
        return analysis;
    })().finally(() => workers.forEach((w) => w.terminate()));

    return { promise, cancel };
}

/** Convenience wrapper when cancellation isn't needed. */
export const analyzeFile = (file, options) => startAnalysis(file, options).promise;
