/* eslint-disable no-restricted-globals */
// Web Worker: scans one byte range, or finalises merged results, off the main thread.

import { finalize } from './finalize';
import { mergePartials } from './merge';
import { scanRange, transferables } from './scanner';

let cancelled = false;

self.onmessage = async ({ data }) => {
    try {
        if (data.type === 'cancel') {
            cancelled = true;
            return;
        }
        if (data.type === 'scan') {
            cancelled = false;
            let last = 0;
            const partial = await scanRange(
                data.file,
                data.range,
                data.plan,
                (progress) => {
                    const now = Date.now();
                    if (now - last > 100) {
                        last = now;
                        self.postMessage({ type: 'progress', ...progress });
                    }
                },
                () => cancelled,
            );
            self.postMessage({ type: 'scanned', partial }, transferables(partial));
        } else if (data.type === 'finalize') {
            const merged = mergePartials(data.partials, data.plan);
            self.postMessage({ type: 'finalized', analysis: finalize(merged, data.plan, data.meta) });
        }
    } catch (error) {
        self.postMessage({ type: 'error', message: error.message || String(error) });
    }
};
