import { useRef, useState } from 'react';
import {
  UploadCloud, FileText, Trash2, Play, Pause, CheckCircle2, Loader2, PackageOpen, Package, Cpu, Scissors, Layers, Search, Database, BookOpen, Sparkles,
} from 'lucide-react';
import { Button, Card, CardHeader, Badge, Progress, Stat, cx, download } from '../components/ui.jsx';
import { ingestFile, exportPack, importPack, forget, resetEmbeddings } from '../lib/kb.js';
import { db } from '../lib/db.js';
import { EMBED_MODELS, embedModelInfo } from '../lib/workers.js';
import { fmtMs, fmtNum } from '../lib/text.js';
import { DEMO_NAME, DEMO_TEXT } from '../lib/demo.js';

const STAGES = [
  { id: 'load', label: 'Load pages', icon: FileText, desc: 'PDF text extraction (pdf.js)' },
  { id: 'clean', label: 'Clean', icon: Scissors, desc: 'Remove watermarks, headers, e-mails' },
  { id: 'chunk', label: 'Chunk', icon: Layers, desc: 'Recursive split by tokens' },
  { id: 'index', label: 'Keyword index', icon: Search, desc: 'BM25 inverted index' },
  { id: 'store', label: 'Store', icon: Database, desc: 'Persist to IndexedDB' },
];

function IngestProgress({ stages }) {
  return (
    <div className="grid gap-2 sm:grid-cols-5">
      {STAGES.map((s) => {
        const st = stages[s.id];
        return (
          <div
            key={s.id}
            className={cx(
              'rounded-xl border p-3 transition',
              st?.status === 'done' ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20' : st?.status === 'running' ? 'border-brand-400 bg-brand-50 dark:bg-brand-900/20' : 'border-slate-200 dark:border-slate-800'
            )}
          >
            <div className="flex items-center gap-1.5 text-sm font-medium">
              {st?.status === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : st?.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin text-brand-600" /> : <s.icon className="h-4 w-4 text-slate-400" />}
              {s.label}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">{st?.detail || s.desc}</div>
            {st?.progress != null && st.status === 'running' && <Progress value={st.progress} className="mt-2" />}
            {st?.ms != null && <div className="mt-1 text-xs font-semibold tabular-nums">{fmtMs(st.ms)}</div>}
          </div>
        );
      })}
    </div>
  );
}

function ManualCard({ m, active, es, onSelect, onDelete, onEmbed, onPause, onExport, onModel, modelStatus }) {
  const total = m.chunkStats?.count || 0;
  const done = es?.done ?? m.embedDone ?? 0;
  const complete = done >= total && total > 0;
  const eta = es?.running && es.rate ? (total - done) / es.rate : null;
  return (
    <Card className={cx('overflow-hidden', active && 'ring-2 ring-brand-500')}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-brand-600" />
            <h3 className="truncate font-semibold">{m.name}</h3>
            {active && <Badge color="brand">active</Badge>}
            {m.imported && <Badge color="violet">imported pack</Badge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {m.title || m.fileName} · {(m.size / 1048576).toFixed(1)} MB · added {new Date(m.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {!active && <Button size="sm" onClick={onSelect}>Use</Button>}
          <Button size="sm" variant="secondary" icon={Package} onClick={onExport} title="Download chunks + embeddings as a shareable pack">Export pack</Button>
          <Button size="sm" variant="ghost" icon={Trash2} onClick={onDelete} aria-label="Delete manual" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 px-5 py-4 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Pages" value={fmtNum(m.pageCount)} hint={m.clean ? `${fmtNum(m.clean.pagesKept)} kept` : ''} />
        <Stat label="Noise removed" value={m.clean ? `${(m.clean.removedShare * 100).toFixed(1)}%` : '–'} hint={m.clean ? `${fmtNum(m.clean.charsRemoved)} chars` : ''} />
        <Stat label="Chunks" value={fmtNum(total)} hint={`${m.chunkSize || 400} tok / ${m.chunkOverlap || 50} overlap`} />
        <Stat label="Tokens / chunk" value={m.chunkStats?.mean ?? '–'} hint={m.chunkStats ? `median ${m.chunkStats.median}, max ${m.chunkStats.max}` : ''} />
        <Stat label="Ingest time" value={m.timings ? fmtMs(Object.values(m.timings).reduce((a, b) => a + b, 0)) : '–'} hint={m.timings ? `load ${fmtMs(m.timings.load)}` : ''} />
        <Stat label="Embed time" value={m.embedMs ? fmtMs(es?.elapsedMs ?? m.embedMs) : '–'} hint={es?.rate ? `${es.rate.toFixed(1)} chunks/s` : ''} />
      </div>
      <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/40">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Cpu className="h-4 w-4 text-violet-600" />
          <span className="font-medium">Semantic index</span>
          <select
            value={m.embedModel}
            onChange={(e) => onModel(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900"
          >
            {EMBED_MODELS.map((x) => (
              <option key={x.id} value={x.id}>{x.label}</option>
            ))}
          </select>
          {complete ? (
            <Badge color="green"><CheckCircle2 className="h-3 w-3" /> ready · hybrid retrieval enabled</Badge>
          ) : es?.running ? (
            <Badge color="violet">
              <Loader2 className="h-3 w-3 animate-spin" /> {fmtNum(done)} / {fmtNum(total)}
              {eta ? ` · ~${fmtMs(eta * 1000)} left` : ''}
            </Badge>
          ) : (
            <Badge color="amber">{done ? `paused at ${Math.round((done / total) * 100)}%` : 'not started'} · BM25 works now</Badge>
          )}
          {es?.error && <Badge color="red">{es.error}</Badge>}
          <div className="ml-auto">
            {!complete && (es?.running ? (
              <Button size="sm" variant="secondary" icon={Pause} onClick={onPause}>Pause</Button>
            ) : (
              <Button size="sm" variant="secondary" icon={Play} onClick={onEmbed}>{done ? 'Resume' : 'Start'} embedding</Button>
            ))}
          </div>
        </div>
        {!complete && <Progress value={total ? done / total : 0} className="mt-2" color="bg-violet-500" />}
        {es?.running && modelStatus?.loading && (
          <p className="mt-1 text-[11px] text-slate-500">Downloading {embedModelInfo(m.embedModel).id} ({Math.round(modelStatus.progress * 100)}%) — cached after first use.</p>
        )}
        {modelStatus?.device && es?.running && <p className="mt-1 text-[11px] text-slate-500">Running on {modelStatus.device === 'webgpu' ? 'WebGPU (GPU)' : 'WASM (CPU)'} — you can keep chatting meanwhile.</p>}
      </div>
    </Card>
  );
}

export default function LibraryView({ settings, manuals, activeManual, setActiveManualId, refreshManuals, startEmbedding, pauseEmbedding, embedStatus, modelStatus, setView, jobs }) {
  const [stages, setStages] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  const packRef = useRef(null);

  async function handleFile(file) {
    if (!file || busy) return;
    setError(null);
    setBusy(true);
    setStages({});
    try {
      if (/\.(medirag|gz)$/i.test(file.name)) {
        const m = await importPack(file);
        await refreshManuals();
        setActiveManualId(m.id);
      } else {
        const m = await ingestFile(
          file,
          { chunkSize: settings.chunkSize, chunkOverlap: settings.chunkOverlap, embedModel: settings.embedModel },
          (u) => setStages((s) => ({ ...s, [u.stage]: { ...s[u.stage], ...u } }))
        );
        await refreshManuals();
        setActiveManualId(m.id);
        startEmbedding(m);
      }
    } catch (e) {
      setError(String(e.message || e));
    }
    setBusy(false);
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Manuals</h1>
          <p className="text-sm text-slate-500">Upload once — everything is processed and stored in your browser, ready for every future session.</p>
        </div>

        <Card>
          <CardHeader icon={UploadCloud} title="Add a manual" subtitle="PDF, TXT or Markdown. Large manuals (4,000+ pages) are fine." />
          <div className="space-y-4 p-5">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                handleFile(e.dataTransfer.files[0]);
              }}
              onClick={() => !busy && fileRef.current?.click()}
              className={cx(
                'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition',
                drag ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-slate-300 hover:border-brand-400 dark:border-slate-700'
              )}
            >
              {busy ? <Loader2 className="h-10 w-10 animate-spin text-brand-600" /> : <UploadCloud className="h-10 w-10 text-brand-600" />}
              <p className="mt-3 font-medium">{busy ? 'Processing…' : 'Drop your manual here or click to browse'}</p>
              <p className="text-xs text-slate-500">
                Chunking {settings.chunkSize} tokens / {settings.chunkOverlap} overlap · embeddings with {embedModelInfo(settings.embedModel).label}
              </p>
              <input ref={fileRef} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" hidden onChange={(e) => handleFile(e.target.files[0])} />
            </div>
            {Object.keys(stages).length > 0 && <IngestProgress stages={stages} />}
            {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={Sparkles} disabled={busy} onClick={() => handleFile(new File([DEMO_TEXT], `${DEMO_NAME}.txt`, { type: 'text/plain' }))}>
                Load demo handbook
              </Button>
              <Button variant="secondary" icon={PackageOpen} disabled={busy} onClick={() => packRef.current?.click()}>
                Import knowledge pack
              </Button>
              <input ref={packRef} type="file" accept=".medirag,.gz" hidden onChange={(e) => handleFile(e.target.files[0])} />
              {activeManual && <Button variant="ghost" onClick={() => setView('chat')}>Go to chat →</Button>}
            </div>
          </div>
        </Card>

        {manuals.map((m) => (
          <ManualCard
            key={m.id}
            m={m}
            active={activeManual?.id === m.id}
            es={embedStatus[m.id]}
            modelStatus={modelStatus}
            onSelect={() => setActiveManualId(m.id)}
            onEmbed={() => startEmbedding(m)}
            onPause={() => pauseEmbedding(m)}
            onExport={async () => download(await exportPack(m), `${m.name.replace(/[^\w]+/g, '_')}.medirag`)}
            onModel={async (model) => {
              if (model === m.embedModel) return;
              if (!confirm('Switching the embedding model rebuilds the semantic index for this manual. Continue?')) return;
              jobs.current.get(m.id)?.stop(true);
              const n = await resetEmbeddings(m, model);
              await refreshManuals();
              startEmbedding(n);
            }}
            onDelete={async () => {
              if (!confirm(`Delete "${m.name}" and all its sessions from this browser?`)) return;
              jobs.current.get(m.id)?.stop(true);
              await db.deleteManual(m.id);
              forget(m.id);
              await refreshManuals();
            }}
          />
        ))}
      </div>
    </div>
  );
}
