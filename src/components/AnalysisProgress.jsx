import React, { useEffect, useRef, useState } from 'react';
import { Cpu, Loader2, X } from 'lucide-react';
import { displayName, formatBytes, formatCompact, formatDuration } from '../lib/analysis';
import { GLOSSARY } from '../lib/glossary';
import { InfoTip } from './ui';

const PHASES = {
    reading: 'Reading the header and sampling the file',
    scanning: 'Streaming every row',
    finalising: 'Finalising statistics and charts',
};

/**
 * Smooths raw progress events into steadily moving numbers: rates are exponential moving
 * averages, the row counter is extrapolated between events, and the ETA counts down in real time.
 */
function useLiveProgress(progress) {
    const track = useRef({ t: 0, rows: 0, bytes: 0, rowRate: 0, byteRate: 0, eta: null, shown: 0 });
    const [, setFrame] = useState(0);

    useEffect(() => {
        const s = track.current;
        const now = performance.now();
        if (progress.phase === 'scanning' && s.t) {
            const dt = (now - s.t) / 1000;
            if (dt > 0.05) {
                const rowRate = (progress.rows - s.rows) / dt;
                const byteRate = (progress.bytesDone - s.bytes) / dt;
                const k = s.rowRate ? 0.3 : 1;
                s.rowRate = s.rowRate + k * (rowRate - s.rowRate);
                s.byteRate = s.byteRate + k * (byteRate - s.byteRate);
            }
        }
        if (progress.rows !== s.rows || !s.t) {
            s.t = now;
            s.rows = progress.rows;
            s.bytes = progress.bytesDone;
        }
        const remaining = Math.max(0, progress.bytesTotal - progress.bytesDone);
        const eta = s.byteRate > 0 && progress.elapsedMs > 800 ? (remaining / s.byteRate) * 1000 : progress.estimatedMs;
        if (eta != null) s.eta = s.eta == null ? eta : s.eta + 0.25 * (eta - s.eta);
        s.etaAt = now;
    }, [progress]);

    useEffect(() => {
        let raf;
        const tick = () => {
            setFrame((f) => (f + 1) % 1e6);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, []);

    const s = track.current;
    const now = performance.now();
    let liveRows = progress.rows;
    if (progress.phase === 'scanning') {
        // Extrapolate between events, never past the projected total, and never backwards.
        const projected = progress.bytesDone > 0 ? (progress.rows * progress.bytesTotal) / progress.bytesDone : progress.estimatedRows || Infinity;
        const since = Math.min((now - s.t) / 1000, 0.6);
        liveRows = Math.max(s.shown, Math.min(projected, s.rows + s.rowRate * since));
        s.shown = liveRows;
    }
    const eta = s.eta == null ? null : Math.max(0, s.eta - (now - (s.etaAt || now)));
    return { liveRows, rowRate: s.rowRate, byteRate: s.byteRate, eta };
}

export default function AnalysisProgress({ fileName, progress, onCancel }) {
    const { liveRows, rowRate, byteRate, eta } = useLiveProgress(progress);
    const fraction = progress.bytesTotal ? Math.min(1, progress.bytesDone / progress.bytesTotal) : 0;
    const finalising = progress.phase === 'finalising';
    const [started] = useState(() => performance.now());
    const elapsed = performance.now() - started;

    return (
        <section className="progress-card" aria-live="polite" aria-busy="true">
            <header className="progress-card__header">
                <div>
                    <p className="eyebrow">
                        <Loader2 className="spin" aria-hidden="true" /> {finalising ? 'Almost done' : 'Analysing every row'}
                    </p>
                    <h2 className="progress-card__title" title={fileName}>
                        {displayName(fileName)}
                    </h2>
                    <p className="progress-card__sub">
                        {formatBytes(progress.bytesTotal)}
                        {progress.workers ? (
                            <>
                                {' · '}
                                <Cpu aria-hidden="true" /> {progress.workers} CPU {progress.workers === 1 ? 'core' : 'cores'}
                                <InfoTip text={GLOSSARY.speed} />
                            </>
                        ) : null}
                        {progress.exact !== undefined && <> · {progress.exact ? 'all values held in memory' : 'streaming mode'}</>}
                    </p>
                </div>
                <button type="button" className="btn btn--ghost" onClick={onCancel}>
                    <X aria-hidden="true" /> Cancel
                </button>
            </header>

            <div className="progress-card__hero">
                <p className="progress-card__count">{Math.round(liveRows).toLocaleString()}</p>
                <p className="progress-card__unit">
                    rows read
                    {progress.estimatedRows ? <> of about {formatCompact(Math.max(progress.estimatedRows, liveRows))}</> : null}
                </p>
            </div>

            <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} aria-label="Analysis progress">
                <span style={{ width: `${finalising ? 100 : fraction * 100}%` }} className={finalising ? 'is-pulsing' : ''} />
            </div>
            <p className="progress-card__phase">
                {progress.phase === 'scanning' && !progress.rows ? `Starting ${progress.workers} background ${progress.workers === 1 ? 'worker' : 'workers'}…` : PHASES[progress.phase] || 'Working…'}{' '}
                {progress.phase === 'scanning' && <strong>{(fraction * 100).toFixed(1)}%</strong>}
            </p>

            <dl className="progress-stats">
                <div>
                    <dt>Elapsed</dt>
                    <dd>{formatDuration(elapsed)}</dd>
                </div>
                <div>
                    <dt>Time remaining</dt>
                    <dd>{finalising ? 'a moment' : eta == null ? 'estimating…' : eta < 1000 ? 'less than a second' : `about ${formatDuration(eta)}`}</dd>
                </div>
                <div>
                    <dt>Speed</dt>
                    <dd>{rowRate ? `${formatCompact(rowRate)} rows/s` : 'measuring'}</dd>
                </div>
                <div>
                    <dt>Throughput</dt>
                    <dd>{byteRate ? `${formatBytes(byteRate)}/s` : 'measuring'}</dd>
                </div>
                <div>
                    <dt>Data read</dt>
                    <dd>
                        {formatBytes(progress.bytesDone)} of {formatBytes(progress.bytesTotal)}
                    </dd>
                </div>
            </dl>
        </section>
    );
}
