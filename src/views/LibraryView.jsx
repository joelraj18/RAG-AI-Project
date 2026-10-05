import { useRef, useState } from 'react';
import { UploadCloud, FileText, Trash2, Play, Pause, CheckCircle2, Loader2, PackageOpen, Package, Cpu, Scissors, Layers, Search, Database, Sparkles, Stethoscope, HardDrive, XCircle, FileType2, Globe, FileCode2, Plus, CloudUpload, Lock } from 'lucide-react';
import { Button, Card, Badge, Progress, Stat, cx, download, TagBadges, PageHeader, SectionTitle, Shelf, LinkButton, useDialog } from '../components/ui.jsx';
import { ingestFile, exportPack, importPack, forget, resetEmbeddings, docBytes } from '../lib/kb.js';
import { ACCEPT } from '../lib/loaders/index.js';
import { db } from '../lib/db.js';
import { EMBED_MODELS, embedModelInfo } from '../lib/workers.js';
import { fmtMs, fmtNum, fmtBytes } from '../lib/text.js';
import { RAG_GUIDE_NAME, RAG_GUIDE_TEXT, MEDICAL_DEMO_NAME, MEDICAL_DEMO_TEXT } from '../lib/demo.js';
import { useStore } from '../state/store.jsx';
import { dataClass, dataRecipient } from '../lib/providers.js';

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
          <div key={s.id} className={cx('rounded-2xl p-3 transition', st?.status === 'done' ? 'bg-emerald-50 dark:bg-emerald-900/20' : st?.status === 'running' ? 'bg-brand-50 dark:bg-brand-900/20' : 'bg-slate-50 dark:bg-slate-800/50')}>
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
  const dialog = useDialog();
  return (
    <Card className="overflow-hidden" id={`doc-${d.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-6">
        <div className="min-w-0">
          <div className="eyebrow mb-1">
            {(d.kind || 'doc').toUpperCase()}
            {inCollection ? ` · in “${activeCollection.name}”` : ''}
            {d.imported ? ' · imported pack' : ''}
          </div>
          <h3 className="headline truncate text-2xl">{d.name}</h3>
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
            variant="secondary"
            icon={Trash2}
            aria-label="Delete document"
            onClick={async () => {
              if (!(await dialog.confirm(`Delete “${d.name}”, its index and its page images from this browser?`, { title: 'Delete document', confirmLabel: 'Delete', danger: true }))) return;
              pauseEmbedding(d, true);
              await db.deleteDoc(d.id);
              forget(d.id);
              await refresh();
            }}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 px-6 py-5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Pages" value={fmtNum(d.pageCount)} hint={d.clean ? `${(d.clean.removedShare * 100).toFixed(1)}% noise removed` : ''} />
        <Stat label="Chunks" value={fmtNum(total)} hint={`${d.chunkStats?.sections || 0} sections · ${d.chunkStats?.dropped || 0} dropped`} />
        <Stat label="Tokens / chunk" value={d.chunkStats?.mean ?? '–'} hint={`${d.chunkSize}/${d.chunkOverlap} size/overlap`} />
        <Stat label="Ingest time" value={fmtMs(ingestMs)} hint={ingestMs && d.pageCount ? `${Math.round(d.pageCount / (ingestMs / 1000))} pages/s` : ''} />
        <Stat label="Embed time" value={d.embedMs ? fmtMs(es?.elapsedMs ?? d.embedMs) : '–'} hint={es?.rate ? `${es.rate.toFixed(1)} chunks/s on ${es.device}` : ''} />
        <Stat label="Storage" value={fmtBytes(bytes.file + bytes.chunks + bytes.vectors)} hint={`vectors ${fmtBytes(bytes.vectors)} (int8)`} />
      </div>
      <div className="border-t border-black/5 px-6 py-4 dark:border-white/10">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Cpu className="h-4 w-4 text-violet-600" />
          <span className="font-medium">Semantic index</span>
          <select
            value={d.embedModel}
            onChange={async (e) => {
              const m = e.target.value;
              if (m === d.embedModel || !(await dialog.confirm('Switching the embedding model rebuilds the semantic index for this document.', { title: 'Change embedding model', confirmLabel: 'Rebuild index' })))
                return;
              pauseEmbedding(d, true);
              const n = await resetEmbeddings(d, m);
              await refresh();
              startEmbedding(n);
            }}
            className="rounded-full bg-slate-100 px-3 py-1 text-xs dark:bg-slate-800"
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
                  if (!(await dialog.confirm(`Free ${fmtBytes(d.size)} by deleting the original file? Answers and citations keep working; only the page image viewer is lost.`, { title: 'Free up space', confirmLabel: 'Delete file' }))) return;
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
        {es?.running && modelStatus?.loading && <p className="mt-1 text-[11px] text-slate-500">Downloading {model.label} ({Math.round(modelStatus.progress * 100)}%), cached after first use.</p>}
      </div>
    </Card>
  );
}

export default function LibraryView() {
  const { settings, setSettings, docs, refresh, addDocToActive, startEmbedding, setView, activeCollection, embedStatus } = useStore();
  const [queue, setQueue] = useState([]); // [{name, status, stages, error}]
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  const packRef = useRef(null);
  const busy = queue.some((q) => q.status === 'running');
  const cloud = dataClass(settings) === 'cloud' && !settings.confidential;

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

  const kindIcon = (k) => ({ pdf: FileText, docx: FileType2, html: Globe, text: FileCode2 })[k] || FileText;
  const status = (d) => {
    const es = embedStatus[d.id];
    if (d.embedDone >= d.chunkStats?.count) return 'Ready';
    if (es?.running) return `Indexing ${Math.round((es.done / es.total) * 100)}%`;
    return 'Keyword search';
  };

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-4 pb-16 sm:px-6">
        <PageHeader
          title="Documents"
          tagline="The best way to understand what you read"
          links={
            <>
              <LinkButton onClick={() => setView('learn')}>How RAG works ↗</LinkButton>
              <LinkButton onClick={() => packRef.current?.click()}>Import a knowledge pack ↗</LinkButton>
            </>
          }
        />

        {docs.length > 0 && (
          <div className="mb-14 flex gap-6 overflow-x-auto pb-2 [scrollbar-width:none]">
            {docs.map((d) => {
              const Icon = kindIcon(d.kind);
              return (
                <button key={d.id} onClick={() => document.getElementById(`doc-${d.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="group flex w-28 shrink-0 flex-col items-center gap-3 text-center">
                  <span className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-white shadow-card transition group-hover:-translate-y-0.5 dark:bg-slate-900">
                    <Icon className="h-9 w-9 text-slate-600 dark:text-slate-300" strokeWidth={1.25} />
                  </span>
                  <span className="line-clamp-2 text-sm font-medium text-ink dark:text-slate-100">{d.name}</span>
                </button>
              );
            })}
            <button onClick={() => !busy && fileRef.current?.click()} className="group flex w-28 shrink-0 flex-col items-center gap-3 text-center">
              <span className="flex h-20 w-20 items-center justify-center rounded-[22px] border-2 border-dashed border-slate-300 transition group-hover:border-brand-600 dark:border-slate-700">
                <Plus className="h-8 w-8 text-slate-400 group-hover:text-brand-600" strokeWidth={1.5} />
              </span>
              <span className="text-sm font-medium text-brand-700 dark:text-brand-400">Add</span>
            </button>
          </div>
        )}

        <SectionTitle title="Add documents" sub="PDF, Word, HTML, Markdown or text, several at once" />
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
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && fileRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Add documents: drop files here or press Enter to browse"
          className={cx(
            'flex cursor-pointer flex-col items-center justify-center rounded-[22px] bg-white px-6 py-14 text-center shadow-card transition outline-none focus-visible:ring-2 focus-visible:ring-brand-600 dark:bg-slate-900',
            drag && 'ring-2 ring-brand-600'
          )}
        >
          {busy ? <Loader2 className="h-12 w-12 animate-spin text-brand-600" strokeWidth={1.25} /> : <UploadCloud className="h-12 w-12 text-brand-600" strokeWidth={1.25} />}
          <p className="headline mt-4 text-2xl">{busy ? 'Processing…' : 'Drop files here'}</p>
          <p className="mt-1 text-[15px] text-slate-500">
            or <span className="text-brand-700 dark:text-brand-400">browse your computer</span> · processed privately in your browser
          </p>
          <p className={cx('mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs', cloud ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300')}>
            {cloud ? <CloudUpload className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            {cloud ? `Files stay on this device. Answers send the relevant excerpts to ${dataRecipient(settings)}.` : 'Files and answers stay on this device. Nothing is uploaded.'}
          </p>
          <p className="mt-3 text-xs text-slate-400">
            {settings.chunkSize}-token chunks · {settings.chunkOverlap} overlap · {embedModelInfo(settings.embedModel).label} embeddings · added to “{activeCollection?.name || 'My library'}”
          </p>
          <input ref={fileRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => handleFiles(e.target.files)} />
        </div>
        {queue.length > 0 && (
          <div className="mt-4 space-y-3">
            {queue.map((q, i) => (
              <Card key={i} className="space-y-3 p-5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {q.status === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : q.status === 'error' ? <XCircle className="h-4 w-4 text-rose-600" /> : q.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin text-brand-600" /> : <FileText className="h-4 w-4 text-slate-400" />}
                  {q.name}
                  <span className="text-xs text-slate-400 capitalize">{q.status}</span>
                </div>
                {q.error && <p className="text-sm text-rose-600">{q.error}</p>}
                {Object.keys(q.stages).length > 0 && <StageRow stages={q.stages} />}
              </Card>
            ))}
          </div>
        )}

        <SectionTitle className="mt-16" title="Try it now" sub="Built-in samples, ready in a second" />
        <Shelf>
          <button disabled={busy} onClick={() => demo(RAG_GUIDE_NAME, RAG_GUIDE_TEXT)} className="flex h-72 w-80 flex-col rounded-[18px] bg-ink p-7 text-left text-white shadow-card transition duration-300 hover:-translate-y-0.5 hover:shadow-card-hover disabled:opacity-60 dark:bg-slate-900" aria-label="Load demo: Guide to RAG">
            <span className="eyebrow text-eyebrow-dark">New</span>
            <span className="headline mt-2 text-[28px] leading-tight text-white">Guide to RAG</span>
            <span className="mt-2 text-[15px] text-slate-300">Learn retrieval-augmented generation by asking the guide itself.</span>
            <Sparkles className="mt-auto h-10 w-10 text-brand-400" strokeWidth={1.25} />
          </button>
          <button disabled={busy} onClick={() => demo(MEDICAL_DEMO_NAME, MEDICAL_DEMO_TEXT, 'medical')} className="flex h-72 w-80 flex-col rounded-[18px] bg-white p-7 text-left shadow-card transition duration-300 hover:-translate-y-0.5 hover:shadow-card-hover disabled:opacity-60 dark:bg-slate-900" aria-label="Load medical sample">
            <span className="eyebrow">Sample</span>
            <span className="headline mt-2 text-[28px] leading-tight">Clinical handbook</span>
            <span className="mt-2 text-[15px] text-slate-500">The five questions from the original Colab notebook, with the Medical preset.</span>
            <Stethoscope className="mt-auto h-10 w-10 text-rose-500" strokeWidth={1.25} />
          </button>
          <button disabled={busy} onClick={() => packRef.current?.click()} className="flex h-72 w-80 flex-col rounded-[18px] bg-white p-7 text-left shadow-card transition duration-300 hover:-translate-y-0.5 hover:shadow-card-hover disabled:opacity-60 dark:bg-slate-900" aria-label="Import knowledge pack">
            <span className="eyebrow">Share</span>
            <span className="headline mt-2 text-[28px] leading-tight">Knowledge pack</span>
            <span className="mt-2 text-[15px] text-slate-500">Import a processed document with chunks and embeddings included, no waiting.</span>
            <PackageOpen className="mt-auto h-10 w-10 text-brand-600" strokeWidth={1.25} />
          </button>
        </Shelf>
        <input ref={packRef} type="file" accept=".ragpack,.gz" hidden onChange={(e) => handleFiles(e.target.files)} />

        {docs.length > 0 && (
          <>
            <SectionTitle
              className="mt-12"
              title="Your library"
              sub={`${docs.length} document${docs.length === 1 ? '' : 's'} · ${fmtBytes(totalBytes)} stored on this device`}
              right={<LinkButton onClick={() => setView('chat')}>Go to chat ›</LinkButton>}
            />
            <Shelf>
              {docs.map((d) => (
                <button key={d.id} onClick={() => document.getElementById(`doc-${d.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="flex h-56 w-72 flex-col rounded-[18px] bg-white p-6 text-left shadow-card transition duration-300 hover:-translate-y-0.5 hover:shadow-card-hover dark:bg-slate-900">
                  <span className={cx('eyebrow', status(d) === 'Ready' && 'text-emerald-700 dark:text-emerald-400')}>{status(d)}</span>
                  <span className="headline mt-2 line-clamp-2 text-xl leading-tight">{d.name}</span>
                  <span className="mt-2 text-sm text-slate-500">
                    {fmtNum(d.pageCount)} pages · {fmtNum(d.chunkStats?.count)} chunks · {fmtBytes(docBytes(d).chunks + docBytes(d).vectors)}
                  </span>
                  <span className="mt-auto text-sm text-brand-700 dark:text-brand-400">Details ›</span>
                </button>
              ))}
            </Shelf>
            <div className="mt-6 space-y-6">
              {docs.map((d) => (
                <DocCard key={d.id} d={d} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
