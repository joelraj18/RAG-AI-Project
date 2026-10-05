import { useRef, useState } from 'react';
import { UploadCloud, FileText, Trash2, Play, Pause, CheckCircle2, Loader2, PackageOpen, Package, Cpu, Scissors, Layers, Search, Database, BookOpen, Sparkles, Stethoscope, HardDrive, XCircle } from 'lucide-react';
import { Button, Card, CardHeader, Badge, Progress, Stat, cx, download, TagBadges } from '../components/ui.jsx';
import { ingestFile, exportPack, importPack, forget, resetEmbeddings, docBytes } from '../lib/kb.js';
import { ACCEPT } from '../lib/loaders/index.js';
import { db } from '../lib/db.js';
import { EMBED_MODELS, embedModelInfo } from '../lib/workers.js';
import { fmtMs, fmtNum, fmtBytes } from '../lib/text.js';
import { RAG_GUIDE_NAME, RAG_GUIDE_TEXT, MEDICAL_DEMO_NAME, MEDICAL_DEMO_TEXT } from '../lib/demo.js';
import { useStore } from '../state/store.jsx';

const STAGES = [
  { id: 'load', label: 'Load', icon: FileText, desc: 'Extract text per page' },
  { id: 'clean', label: 'Clean', icon: Scissors, desc: 'Remove repeated headers/watermarks' },
  { id: 'chunk', label: 'Chunk', icon: Layers, desc: 'Section-aware token chunks' },
  { id: 'index', label: 'Keyword index', icon: Search, desc: 'BM25 inverted index' },
  { id: 'store', label: 'Store', icon: Database, desc: 'Save to IndexedDB' },
];

function StageRow({ stages }) {
  return (
    <div className="grid gap-2 sm:grid-cols-5">
      {STAGES.map((s) => {
        const st = stages[s.id];
        return (
          <div key={s.id} className={cx('rounded-xl border p-2.5 transition', st?.status === 'done' ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20' : st?.status === 'running' ? 'border-brand-400 bg-brand-50 dark:bg-brand-900/20' : 'border-slate-200 dark:border-slate-800')}>
            <div className="flex items-center gap-1.5 text-xs font-medium">
              {st?.status === 'done' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : st?.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" /> : <s.icon className="h-3.5 w-3.5 text-slate-400" />}
              {s.label}
              {st?.ms != null && <span className="ml-auto tabular-nums">{fmtMs(st.ms)}</span>}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">{st?.detail || s.desc}</div>
            {st?.progress != null && st.status === 'running' && <Progress value={st.progress} className="mt-1.5" />}
          </div>
        );
      })}
    </div>
  );
}

function DocCard({ d }) {
  const { embedStatus, modelStatus, startEmbedding, pauseEmbedding, refresh, activeCollection, updateCollection } = useStore();
  const es = embedStatus[d.id];
  const total = d.chunkStats?.count || 0;
  const done = es?.done ?? d.embedDone ?? 0;
  const complete = done >= total && total > 0;
  const eta = es?.running && es.rate ? (total - done) / es.rate : null;
  const bytes = docBytes(d);
  const ingestMs = d.timings ? Object.values(d.timings).reduce((a, b) => a + b, 0) : null;
  const inCollection = activeCollection?.docIds.includes(d.id);
  const model = embedModelInfo(d.embedModel);
  return (
    <Card className={cx('overflow-hidden', inCollection && 'ring-2 ring-brand-500/60')}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <BookOpen className="h-4 w-4 text-brand-600" />
            <h3 className="truncate font-semibold">{d.name}</h3>
            <Badge>{(d.kind || 'doc').toUpperCase()}</Badge>
            {inCollection && <Badge color="brand">in “{activeCollection.name}”</Badge>}
            {d.imported && <Badge color="violet">imported pack</Badge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {d.title && d.title !== d.name ? `${d.title} · ` : ''}
            {d.fileName} · added {new Date(d.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {activeCollection && (
            <Button size="sm" variant={inCollection ? 'secondary' : 'primary'} onClick={() => updateCollection({ ...activeCollection, docIds: inCollection ? activeCollection.docIds.filter((x) => x !== d.id) : [...activeCollection.docIds, d.id] })}>
              {inCollection ? 'Remove from collection' : 'Add to collection'}
            </Button>
          )}
          <Button size="sm" variant="secondary" icon={Package} onClick={async () => download(await exportPack(d), `${d.name.replace(/[^\w]+/g, '_')}.ragpack`)} title="Chunks + int8 embeddings in one file; importing it skips all processing">
            Export pack
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            aria-label="Delete document"
            onClick={async () => {
              if (!confirm(`Delete "${d.name}" from this browser?`)) return;
              pauseEmbedding(d, true);
              await db.deleteDoc(d.id);
              forget(d.id);
              await refresh();
            }}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 px-5 py-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Pages" value={fmtNum(d.pageCount)} hint={d.clean ? `${(d.clean.removedShare * 100).toFixed(1)}% noise removed` : ''} />
        <Stat label="Chunks" value={fmtNum(total)} hint={`${d.chunkStats?.sections || 0} sections · ${d.chunkStats?.dropped || 0} dropped`} />
        <Stat label="Tokens / chunk" value={d.chunkStats?.mean ?? '–'} hint={`${d.chunkSize}/${d.chunkOverlap} size/overlap`} />
        <Stat label="Ingest time" value={fmtMs(ingestMs)} hint={ingestMs && d.pageCount ? `${Math.round(d.pageCount / (ingestMs / 1000))} pages/s` : ''} />
        <Stat label="Embed time" value={d.embedMs ? fmtMs(es?.elapsedMs ?? d.embedMs) : '–'} hint={es?.rate ? `${es.rate.toFixed(1)} chunks/s on ${es.device}` : ''} />
        <Stat label="Storage" value={fmtBytes(bytes.file + bytes.chunks + bytes.vectors)} hint={`vectors ${fmtBytes(bytes.vectors)} (int8)`} />
      </div>
      <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/40">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Cpu className="h-4 w-4 text-violet-600" />
          <span className="font-medium">Semantic index</span>
          <select
            value={d.embedModel}
            onChange={async (e) => {
              const m = e.target.value;
              if (m === d.embedModel || !confirm('Switching the embedding model rebuilds the semantic index for this document. Continue?')) return;
              pauseEmbedding(d, true);
              const n = await resetEmbeddings(d, m);
              await refresh();
              startEmbedding(n);
            }}
            className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900"
          >
            {EMBED_MODELS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label} · {x.size}
              </option>
            ))}
          </select>
          <TagBadges tags={model.tags} />
          {complete ? (
            <Badge color="green"><CheckCircle2 className="h-3 w-3" /> ready · hybrid search on</Badge>
          ) : es?.running ? (
            <Badge color="violet"><Loader2 className="h-3 w-3 animate-spin" /> {fmtNum(done)} / {fmtNum(total)}{eta ? ` · ~${fmtMs(eta * 1000)} left` : ''}</Badge>
          ) : (
            <Badge color="amber">{done ? `paused at ${Math.round((done / total) * 100)}%` : 'not started'} · keyword search works now</Badge>
          )}
          {es?.error && <Badge color="red">{es.error}</Badge>}
          <div className="ml-auto flex gap-1.5">
            {d.hasFile && (
              <Button
                size="sm"
                variant="ghost"
                icon={HardDrive}
                title="Delete the original file to save space; answers and citations keep working, only the page image viewer is lost"
                onClick={async () => {
                  if (!confirm(`Free ${fmtBytes(d.size)} by deleting the original file? The page image viewer will no longer be available.`)) return;
                  await db.deleteFile(d.id);
                  await db.putDoc({ ...d, hasFile: false });
                  await refresh();
                }}
              >
                Free {fmtBytes(d.size)}
              </Button>
            )}
            {!complete &&
              (es?.running ? (
                <Button size="sm" variant="secondary" icon={Pause} onClick={() => pauseEmbedding(d)}>Pause</Button>
              ) : (
                <Button size="sm" variant="secondary" icon={Play} onClick={() => startEmbedding(d)}>{done ? 'Resume' : 'Start'} embedding</Button>
              ))}
          </div>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">{model.why}</p>
        {!complete && <Progress value={total ? done / total : 0} className="mt-2" color="bg-violet-500" />}
        {es?.running && modelStatus?.loading && <p className="mt-1 text-[11px] text-slate-500">Downloading {model.label} ({Math.round(modelStatus.progress * 100)}%) — cached after first use.</p>}
      </div>
    </Card>
  );
}

export default function LibraryView() {
  const { settings, setSettings, docs, refresh, addDocToActive, startEmbedding, setView, activeCollection } = useStore();
  const [queue, setQueue] = useState([]); // [{name, status, stages, error}]
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  const packRef = useRef(null);
  const busy = queue.some((q) => q.status === 'running');

  async function handleFiles(files) {
    const list = [...files];
    if (!list.length || busy) return;
    setQueue(list.map((f) => ({ name: f.name, status: 'queued', stages: {} })));
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const upd = (patch) => setQueue((q) => q.map((x, j) => (j === i ? { ...x, ...patch(x) } : x)));
      upd(() => ({ status: 'running' }));
      try {
        let d;
        if (/\.(ragpack|gz)$/i.test(f.name)) d = await importPack(f);
        else d = await ingestFile(f, { chunkSize: settings.chunkSize, chunkOverlap: settings.chunkOverlap, embedModel: settings.embedModel }, (u) => upd((x) => ({ stages: { ...x.stages, [u.stage]: { ...x.stages[u.stage], ...u } } })));
        await addDocToActive(d.id);
        upd(() => ({ status: 'done' }));
        startEmbedding(d);
      } catch (e) {
        upd(() => ({ status: 'error', error: String(e.message || e) }));
      }
    }
    await refresh();
  }

  const demo = (name, text, presetId) => {
    if (presetId) setSettings({ preset: presetId });
    handleFiles([new File([text], `${name}.md`, { type: 'text/markdown' })]);
  };

  const totalBytes = docs.reduce((s, d) => {
    const b = docBytes(d);
    return s + b.file + b.chunks + b.vectors;
  }, 0);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Documents</h1>
            <p className="text-sm text-slate-500">Upload once — everything is processed and stored in your browser. New documents join the active collection{activeCollection ? ` “${activeCollection.name}”` : ''}.</p>
          </div>
          {docs.length > 0 && <Badge>{docs.length} documents · {fmtBytes(totalBytes)} stored</Badge>}
        </div>

        <Card>
          <CardHeader icon={UploadCloud} title="Add documents" subtitle="PDF, Word (.docx), HTML, Markdown or text — several at once. 4,000-page books are fine." />
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
                handleFiles(e.dataTransfer.files);
              }}
              onClick={() => !busy && fileRef.current?.click()}
              className={cx('flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition', drag ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-slate-300 hover:border-brand-400 dark:border-slate-700')}
            >
              {busy ? <Loader2 className="h-10 w-10 animate-spin text-brand-600" /> : <UploadCloud className="h-10 w-10 text-brand-600" />}
              <p className="mt-3 font-medium">{busy ? 'Processing…' : 'Drop files here or click to browse'}</p>
              <p className="text-xs text-slate-500">
                Chunks of {settings.chunkSize} tokens / {settings.chunkOverlap} overlap · embeddings with {embedModelInfo(settings.embedModel).label} (change in Settings)
              </p>
              <input ref={fileRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => handleFiles(e.target.files)} />
            </div>
            {queue.map((q, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {q.status === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : q.status === 'error' ? <XCircle className="h-4 w-4 text-rose-600" /> : q.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin text-brand-600" /> : <FileText className="h-4 w-4 text-slate-400" />}
                  {q.name}
                  <span className="text-xs text-slate-400">{q.status}</span>
                </div>
                {q.error && <p className="text-sm text-rose-600">{q.error}</p>}
                {Object.keys(q.stages).length > 0 && <StageRow stages={q.stages} />}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={Sparkles} disabled={busy} onClick={() => demo(RAG_GUIDE_NAME, RAG_GUIDE_TEXT)}>Load demo: Guide to RAG</Button>
              <Button variant="secondary" icon={Stethoscope} disabled={busy} onClick={() => demo(MEDICAL_DEMO_NAME, MEDICAL_DEMO_TEXT, 'medical')}>Load medical sample</Button>
              <Button variant="secondary" icon={PackageOpen} disabled={busy} onClick={() => packRef.current?.click()}>Import knowledge pack</Button>
              <input ref={packRef} type="file" accept=".ragpack,.gz" hidden onChange={(e) => handleFiles(e.target.files)} />
              {docs.length > 0 && <Button variant="ghost" onClick={() => setView('chat')}>Go to chat →</Button>}
            </div>
          </div>
        </Card>

        {docs.map((d) => (
          <DocCard key={d.id} d={d} />
        ))}
      </div>
    </div>
  );
}
