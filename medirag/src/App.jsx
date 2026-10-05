import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from './components/Sidebar.jsx';
import PageViewer from './components/PageViewer.jsx';
import ChatView from './views/ChatView.jsx';
import LibraryView from './views/LibraryView.jsx';
import SettingsView from './views/SettingsView.jsx';
import AboutView from './views/AboutView.jsx';
import { db, requestPersistence } from './lib/db.js';
import { loadSettings, saveSettings } from './lib/settings.js';
import { loadKnowledge, EmbedJob } from './lib/kb.js';
import { embedClient } from './lib/workers.js';
import { uid } from './lib/text.js';

const LabView = lazy(() => import('./views/LabView.jsx'));

const LAST_MANUAL = 'medirag.activeManual';

export default function App() {
  const [settings, setSettingsState] = useState(loadSettings);
  const [manuals, setManuals] = useState([]);
  const [activeManualId, setActiveManualIdState] = useState(() => localStorage.getItem(LAST_MANUAL));
  const [view, setView] = useState('chat');
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [kb, setKb] = useState(null);
  const [embedStatus, setEmbedStatus] = useState({});
  const [modelStatus, setModelStatus] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [booted, setBooted] = useState(false);
  const jobs = useRef(new Map());

  const setSettings = useCallback((patch) => {
    setSettingsState((s) => {
      const n = { ...s, ...patch };
      saveSettings(n);
      return n;
    });
  }, []);

  const prefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && prefersDark);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const activeManual = useMemo(() => manuals.find((m) => m.id === activeManualId) || manuals[0] || null, [manuals, activeManualId]);

  const setActiveManualId = (id) => {
    setActiveManualIdState(id);
    try {
      localStorage.setItem(LAST_MANUAL, id);
    } catch {
      /* ignore */
    }
  };

  const refreshManuals = useCallback(async () => {
    const list = await db.listManuals();
    setManuals(list);
    return list;
  }, []);

  useEffect(() => {
    refreshManuals().then((list) => {
      setBooted(true);
      if (!list.length) setView('library');
    });
    requestPersistence();
    return embedClient.onStatus((msg) => {
      if (msg.type === 'ready') setModelStatus({ device: msg.device });
      else if (msg.progress?.status === 'progress' && msg.progress.file?.endsWith('.onnx'))
        setModelStatus({ loading: true, file: msg.progress.file, progress: (msg.progress.progress || 0) / 100 });
    });
  }, [refreshManuals]);

  // ----- background embedding -----
  const startEmbedding = useCallback(
    (manual) => {
      if (!manual || jobs.current.get(manual.id)?.running) return;
      if (manual.embedDone >= manual.chunkStats?.count) return;
      const job = new EmbedJob(manual, {
        onProgress: (p) => setEmbedStatus((s) => ({ ...s, [manual.id]: { ...p, running: true } })),
        onDone: async () => {
          setEmbedStatus((s) => ({ ...s, [manual.id]: { ...(s[manual.id] || {}), running: false, finished: true } }));
          await refreshManuals();
        },
        onError: (e) => {
          const msg = String(e.message || e);
          const error = /fetch|network|load/i.test(msg) ? 'Could not download the embedding model (offline?). Keyword search still works — retry later.' : msg;
          setEmbedStatus((s) => ({ ...s, [manual.id]: { ...(s[manual.id] || {}), running: false, error } }));
        },
      });
      jobs.current.set(manual.id, job);
      setEmbedStatus((s) => ({ ...s, [manual.id]: { done: manual.embedDone || 0, total: manual.chunkStats.count, running: true, error: null } }));
      job.start();
    },
    [refreshManuals]
  );

  const pauseEmbedding = useCallback(
    async (manual) => {
      jobs.current.get(manual.id)?.stop();
      setEmbedStatus((s) => ({ ...s, [manual.id]: { ...(s[manual.id] || {}), running: false } }));
      setTimeout(refreshManuals, 500);
    },
    [refreshManuals]
  );

  // ----- load knowledge + sessions for the active manual -----
  useEffect(() => {
    let cancelled = false;
    setKb(null);
    if (!activeManual) {
      setSessions([]);
      return;
    }
    loadKnowledge(activeManual).then((k) => !cancelled && setKb(k));
    db.listSessions(activeManual.id).then((list) => {
      if (cancelled) return;
      setSessions(list);
      setActiveSessionId((cur) => (list.some((s) => s.id === cur) ? cur : list[0]?.id || null));
    });
    if (activeManual.embedDone < activeManual.chunkStats?.count) startEmbedding(activeManual);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeManual?.id]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  const newSession = useCallback(() => {
    if (!activeManual) return null;
    const s = { id: uid(), manualId: activeManual.id, title: 'New session', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    setSessions((list) => [s, ...list]);
    setActiveSessionId(s.id);
    return s;
  }, [activeManual]);

  const saveSession = useCallback((s) => {
    const n = { ...s, updatedAt: Date.now() };
    setSessions((list) => [n, ...list.filter((x) => x.id !== s.id)]);
    if (n.messages.length) db.putSession(n);
    return n;
  }, []);

  const deleteSession = useCallback(async (id) => {
    await db.deleteSession(id);
    setSessions((list) => list.filter((s) => s.id !== id));
    setActiveSessionId((cur) => (cur === id ? null : cur));
  }, []);

  const openPage = useCallback((page, highlight) => setViewer({ page, highlight }), []);
  const chunksForPage = useCallback((p) => (kb ? kb.chunks.filter((c) => c.page === p) : []), [kb]);

  const shared = { settings, setSettings, manuals, activeManual, kb, embedStatus, modelStatus, openPage, setView };

  return (
    <div className="flex h-full">
      <Sidebar
        view={view}
        setView={setView}
        manuals={manuals}
        activeManual={activeManual}
        setActiveManualId={setActiveManualId}
        sessions={sessions}
        activeSessionId={activeSessionId}
        setActiveSessionId={setActiveSessionId}
        newSession={newSession}
        deleteSession={deleteSession}
        embedStatus={embedStatus}
        dark={dark}
        toggleDark={() => setSettings({ theme: dark ? 'light' : 'dark' })}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 md:hidden dark:border-slate-800 dark:bg-slate-900">
          <button onClick={() => setSidebarOpen(true)} className="rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold">MediRAG Studio</span>
        </div>
        {booted && view === 'chat' && (
          <ChatView {...shared} session={activeSession} newSession={newSession} saveSession={saveSession} />
        )}
        {view === 'library' && (
          <LibraryView
            {...shared}
            refreshManuals={refreshManuals}
            setActiveManualId={setActiveManualId}
            startEmbedding={startEmbedding}
            pauseEmbedding={pauseEmbedding}
            jobs={jobs}
          />
        )}
        {view === 'lab' && (
          <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading Evaluation Lab…</div>}>
            <LabView {...shared} />
          </Suspense>
        )}
        {view === 'settings' && <SettingsView {...shared} />}
        {view === 'about' && <AboutView {...shared} />}
      </main>
      {viewer && activeManual && (
        <PageViewer manual={activeManual} page={viewer.page} highlight={viewer.highlight} chunksForPage={chunksForPage} onClose={() => setViewer(null)} />
      )}
    </div>
  );
}
