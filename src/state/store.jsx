import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { db, requestPersistence } from '../lib/db.js';
import { loadSettings, saveSettings } from '../lib/settings.js';
import { loadKnowledge, cachedKnowledge, EmbedJob } from '../lib/kb.js';
import { embedClient } from '../lib/workers.js';
import { slimRecord } from '../lib/pipeline.js';
import { uid } from '../lib/text.js';
import { whoami } from '../lib/hf.js';
import { getUsage, onUsage } from '../lib/usage.js';

// Central app state: settings, documents, collections, sessions, background embedding.

const Ctx = createContext(null);
export const useStore = () => useContext(Ctx);

const LAST_COLLECTION = 'rag-ai-studio.activeCollection';
const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

const slimSession = (s) => ({ ...s, messages: s.messages.map((m) => ({ ...m, rag: slimRecord(m.rag), vanilla: slimRecord(m.vanilla) })) });

export function StoreProvider({ children }) {
  const [settings, setSettingsState] = useState(loadSettings);
  const [docs, setDocs] = useState([]);
  const [collections, setCollections] = useState([]);
  const [activeCollectionId, setActiveCollectionIdState] = useState(() => lsGet(LAST_COLLECTION));
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [sets, setSets] = useState([]); // [{doc, kb}] for the active collection
  const [kbLoading, setKbLoading] = useState(false);
  const [embedStatus, setEmbedStatus] = useState({});
  const [modelStatus, setModelStatus] = useState(null);
  const [view, setView] = useState('chat');
  const [viewer, setViewer] = useState(null);
  const [booted, setBooted] = useState(false);
  const jobs = useRef(new Map());
  const [hfAccount, setHfAccount] = useState(null); // { status: 'checking'|'ok'|'error', ...whoami } — memory only
  const [usage, setUsage] = useState(getUsage);
  useEffect(() => onUsage(() => setUsage({ ...getUsage() })), []);

  const setSettings = useCallback((patch) => {
    setSettingsState((s) => {
      const n = { ...s, ...patch };
      saveSettings(n);
      return n;
    });
  }, []);

  const refresh = useCallback(async () => {
    const [d, c] = await Promise.all([db.listDocs(), db.listCollections()]);
    setDocs(d);
    setCollections(c);
    return { docs: d, collections: c };
  }, []);

  const activeCollection = useMemo(
    () => collections.find((c) => c.id === activeCollectionId) || collections[0] || null,
    [collections, activeCollectionId]
  );
  const activeDocs = useMemo(() => (activeCollection ? docs.filter((d) => activeCollection.docIds.includes(d.id)) : []), [docs, activeCollection]);

  const setActiveCollectionId = useCallback((id) => {
    setActiveCollectionIdState(id);
    lsSet(LAST_COLLECTION, id);
  }, []);

  // ---------- boot ----------
  useEffect(() => {
    (async () => {
      const { docs: d, collections: c } = await refresh();
      if (d.length && !c.length) {
        await db.putCollection({ id: uid(), name: 'My library', docIds: d.map((x) => x.id), createdAt: Date.now() });
        await refresh();
      }
      setBooted(true);
      if (!d.length) setView('library');
    })();
    requestPersistence();
    return embedClient.onStatus((msg) => {
      if (msg.type === 'ready') setModelStatus({ device: msg.device });
      else if (msg.progress?.status === 'progress' && msg.progress.file?.endsWith('.onnx'))
        setModelStatus({ loading: true, file: msg.progress.file, progress: (msg.progress.progress || 0) / 100 });
    });
  }, [refresh]);

  // ---------- background embedding ----------
  const startEmbedding = useCallback(
    (doc) => {
      if (!doc || jobs.current.get(doc.id)?.running) return;
      if (doc.embedDone >= doc.chunkStats?.count) return;
      const job = new EmbedJob(doc, {
        onProgress: (p) => setEmbedStatus((s) => ({ ...s, [doc.id]: { ...p, running: true } })),
        onDone: async () => {
          setEmbedStatus((s) => ({ ...s, [doc.id]: { ...(s[doc.id] || {}), running: false, finished: true } }));
          await refresh();
        },
        onError: (e) => {
          const msg = String(e.message || e);
          const error = /fetch|network|load/i.test(msg) ? 'Could not download the embedding model (offline?). Keyword search still works — retry later.' : msg;
          setEmbedStatus((s) => ({ ...s, [doc.id]: { ...(s[doc.id] || {}), running: false, error } }));
        },
      });
      jobs.current.set(doc.id, job);
      setEmbedStatus((s) => ({ ...s, [doc.id]: { done: doc.embedDone || 0, total: doc.chunkStats.count, running: true, error: null } }));
      job.start();
    },
    [refresh]
  );

  const pauseEmbedding = useCallback(
    (doc, discard = false) => {
      jobs.current.get(doc.id)?.stop(discard);
      setEmbedStatus((s) => ({ ...s, [doc.id]: { ...(s[doc.id] || {}), running: false } }));
      setTimeout(refresh, 400);
    },
    [refresh]
  );

  // ---------- load knowledge for the active collection ----------
  const docKey = activeDocs.map((d) => `${d.id}:${d.embedModel}`).join('|');
  useEffect(() => {
    let cancelled = false;
    setKbLoading(true);
    Promise.all(activeDocs.map(async (doc) => ({ doc, kb: await loadKnowledge(doc) }))).then((s) => {
      if (cancelled) return;
      setSets(s);
      setKbLoading(false);
    });
    activeDocs.forEach((d) => d.embedDone < d.chunkStats?.count && startEmbedding(d));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  // keep doc objects inside `sets` fresh (embedding progress) without reloading knowledge
  const liveSets = useMemo(() => sets.map((s) => ({ ...s, doc: docs.find((d) => d.id === s.doc.id) || s.doc })), [sets, docs]);

  // ---------- sessions ----------
  useEffect(() => {
    let cancelled = false;
    if (!activeCollection) return setSessions([]);
    const collectionId = activeCollection.id;
    db.listSessions(collectionId).then((list) => {
      if (cancelled) return;
      setSessions(list);
      setActiveSessionId((cur) => (list.some((s) => s.id === cur) ? cur : list[0]?.id || null));
    });
    return () => {
      cancelled = true;
    };
    // keyed on the id: refresh() creates new collection objects (e.g. when embedding finishes),
    // which must not reload sessions and overwrite an answer that is still streaming
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCollection?.id]);

  const newSession = useCallback(() => {
    if (!activeCollection) return null;
    const s = { id: uid(), collectionId: activeCollection.id, title: 'New session', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    setSessions((list) => [s, ...list]);
    setActiveSessionId(s.id);
    return s;
  }, [activeCollection]);

  /** Update a session in memory; write to IndexedDB only when `persist` (phase changes / done). */
  const saveSession = useCallback((s, persist = true) => {
    const n = { ...s, updatedAt: Date.now() };
    setSessions((list) => [n, ...list.filter((x) => x.id !== s.id)]);
    if (persist && n.messages.length) db.putSession(slimSession(n));
    return n;
  }, []);

  const deleteSession = useCallback(async (id) => {
    await db.deleteSession(id);
    setSessions((list) => list.filter((s) => s.id !== id));
    setActiveSessionId((cur) => (cur === id ? null : cur));
  }, []);

  const importSession = useCallback(
    async (data) => {
      if (!activeCollection || !Array.isArray(data?.messages)) throw new Error('Not a RAG AI Studio session file.');
      const s = { ...data, id: uid(), collectionId: activeCollection.id, updatedAt: Date.now() };
      await db.putSession(slimSession(s));
      setSessions((list) => [s, ...list]);
      setActiveSessionId(s.id);
    },
    [activeCollection]
  );

  // ---------- collections ----------
  const createCollection = useCallback(
    async (name, docIds = []) => {
      const c = { id: uid(), name, docIds, createdAt: Date.now() };
      await db.putCollection(c);
      await refresh();
      setActiveCollectionId(c.id);
      return c;
    },
    [refresh, setActiveCollectionId]
  );

  const updateCollection = useCallback(
    async (c) => {
      await db.putCollection(c);
      await refresh();
    },
    [refresh]
  );

  const deleteCollection = useCallback(
    async (id) => {
      await db.deleteCollection(id);
      await refresh();
    },
    [refresh]
  );

  const addDocToActive = useCallback(
    async (docId) => {
      const list = await db.listCollections();
      const cur = list.find((c) => c.id === activeCollectionId) || list[0];
      if (cur) await db.putCollection({ ...cur, docIds: [...new Set([...cur.docIds, docId])] });
      else {
        const c = { id: uid(), name: 'My library', docIds: [docId], createdAt: Date.now() };
        await db.putCollection(c);
        setActiveCollectionId(c.id);
      }
      await refresh();
    },
    [activeCollectionId, refresh, setActiveCollectionId]
  );

  // ---------- Hugging Face account (plan detection via the free whoami endpoint) ----------
  const token = settings.provider === 'hf' ? settings.hfToken : '';
  useEffect(() => {
    if (!token) return setHfAccount(null);
    const ctrl = new AbortController();
    setHfAccount({ status: 'checking' });
    const t = setTimeout(async () => {
      try {
        const r = await whoami(token, ctrl.signal);
        setHfAccount({ status: r.ok ? 'ok' : 'error', ...r });
      } catch {
        /* aborted */
      }
    }, 600);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [token]);
  const effectivePlan = settings.hfPlan !== 'auto' ? settings.hfPlan : hfAccount?.plan || 'free';

  const kbOf = useCallback((docId) => cachedKnowledge(docId), []);
  const openPage = useCallback((docId, page, highlight) => setViewer({ docId, page, highlight }), []);

  const value = {
    settings,
    setSettings,
    docs,
    collections,
    activeCollection,
    activeDocs,
    setActiveCollectionId,
    createCollection,
    updateCollection,
    deleteCollection,
    addDocToActive,
    refresh,
    sets: liveSets,
    kbLoading,
    kbOf,
    embedStatus,
    modelStatus,
    startEmbedding,
    pauseEmbedding,
    jobs,
    sessions,
    activeSessionId,
    setActiveSessionId,
    newSession,
    saveSession,
    deleteSession,
    importSession,
    view,
    setView,
    viewer,
    setViewer,
    openPage,
    booted,
    hfAccount,
    effectivePlan,
    usage,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
