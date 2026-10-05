import { MessageSquare, Library, FlaskConical, Settings, GraduationCap, Plus, Trash2, Sparkles, Moon, Sun, X, FolderPlus, FileText } from 'lucide-react';
import { cx } from './ui.jsx';
import { useStore } from '../state/store.jsx';
import { preset } from '../lib/presets.js';

const NAV = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'library', label: 'Documents', icon: Library },
  { id: 'lab', label: 'Evaluation Lab', icon: FlaskConical },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'learn', label: 'Learn RAG', icon: GraduationCap },
];

export default function Sidebar({ dark, toggleDark, open, onClose }) {
  const s = useStore();
  const { view, setView, collections, activeCollection, docs, embedStatus } = s;
  const go = (v) => {
    setView(v);
    onClose();
  };

  return (
    <>
      <div className={cx('fixed inset-0 z-30 bg-slate-900/40 md:hidden', open ? 'block' : 'hidden')} onClick={onClose} />
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform md:static md:translate-x-0 dark:border-slate-800 dark:bg-slate-900',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 p-2 text-white shadow">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="leading-tight font-bold text-slate-900 dark:text-white">RAG AI Studio</div>
              <div className="text-[11px] text-slate-500">Chat with any document · {preset(s.settings.preset).label}</div>
            </div>
          </div>
          <div className="flex items-center">
            <button onClick={toggleDark} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Toggle theme">
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden dark:hover:bg-slate-800" aria-label="Close menu">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <nav className="space-y-0.5 px-2">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              className={cx(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition',
                view === n.id ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              )}
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </button>
          ))}
        </nav>

        <div className="scroll-thin mt-3 flex-1 overflow-y-auto px-4 pb-3">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Collection</label>
            <button
              onClick={async () => {
                const name = prompt('Name for the new collection:', 'New collection');
                if (name) await s.createCollection(name.trim());
              }}
              className="flex items-center gap-1 rounded px-1 text-xs text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-900/30"
              title="Create a collection (a set of documents to chat with together)"
            >
              <FolderPlus className="h-3.5 w-3.5" /> New
            </button>
          </div>
          {collections.length ? (
            <select
              value={activeCollection?.id || ''}
              onChange={(e) => s.setActiveCollectionId(e.target.value)}
              className="mt-1 w-full truncate rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.docIds.length})
                </option>
              ))}
            </select>
          ) : (
            <button onClick={() => go('library')} className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 hover:border-brand-400 hover:text-brand-700 dark:border-slate-700">
              <FileText className="h-4 w-4" /> Add a document
            </button>
          )}

          {activeCollection && docs.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {docs.map((d) => {
                const on = activeCollection.docIds.includes(d.id);
                const es = embedStatus[d.id];
                const ready = d.embedDone >= d.chunkStats?.count;
                return (
                  <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50" title={on ? 'Included in this collection' : 'Not in this collection'}>
                    <input
                      type="checkbox"
                      className="accent-brand-600"
                      checked={on}
                      onChange={() =>
                        s.updateCollection({ ...activeCollection, docIds: on ? activeCollection.docIds.filter((x) => x !== d.id) : [...activeCollection.docIds, d.id] })
                      }
                    />
                    <span className={cx('flex-1 truncate', on ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400')}>{d.name}</span>
                    <span className={cx('text-[10px]', ready ? 'text-emerald-600' : 'text-amber-600')}>
                      {ready ? 'semantic' : es?.running ? `${Math.round((es.done / es.total) * 100)}%` : 'keyword'}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Sessions</span>
            <button
              onClick={() => {
                s.newSession();
                go('chat');
              }}
              disabled={!activeCollection}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-40 dark:text-brand-300 dark:hover:bg-brand-900/30"
            >
              <Plus className="h-3.5 w-3.5" /> New
            </button>
          </div>
          <div className="mt-1 space-y-0.5">
            {s.sessions.map((x) => (
              <div key={x.id} className={cx('group flex items-center rounded-lg pr-1 text-sm', x.id === s.activeSessionId && view === 'chat' ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50')}>
                <button
                  className="flex-1 truncate px-2 py-1.5 text-left text-slate-700 dark:text-slate-300"
                  onClick={() => {
                    s.setActiveSessionId(x.id);
                    go('chat');
                  }}
                  title={x.title}
                >
                  {x.title}
                  <span className="block text-[11px] text-slate-400">
                    {x.messages.length} Q · {new Date(x.updatedAt).toLocaleDateString()}
                  </span>
                </button>
                <button onClick={() => s.deleteSession(x.id)} className="rounded p-1 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-rose-600" aria-label="Delete session">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {activeCollection && !s.sessions.length && <p className="px-2 py-1 text-xs text-slate-400">No sessions yet — ask your first question.</p>}
          </div>
        </div>
        <div className="border-t border-slate-200 px-4 py-2.5 text-[11px] text-slate-400 dark:border-slate-800">
          Documents, indexes and chats stay in this browser (IndexedDB). Answers can be wrong — check the cited pages.
        </div>
      </aside>
    </>
  );
}
