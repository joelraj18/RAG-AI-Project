import { MessageSquare, Library, FlaskConical, Settings, Info, Plus, Trash2, Stethoscope, Moon, Sun, X, BookMarked } from 'lucide-react';
import { cx } from './ui.jsx';

const NAV = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'library', label: 'Manuals', icon: Library },
  { id: 'lab', label: 'Evaluation Lab', icon: FlaskConical },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'about', label: 'How it works', icon: Info },
];

export default function Sidebar({
  view,
  setView,
  manuals,
  activeManual,
  setActiveManualId,
  sessions,
  activeSessionId,
  setActiveSessionId,
  newSession,
  deleteSession,
  embedStatus,
  dark,
  toggleDark,
  open,
  onClose,
}) {
  const es = activeManual && embedStatus[activeManual.id];
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
              <Stethoscope className="h-5 w-5" />
            </div>
            <div>
              <div className="leading-tight font-bold text-slate-900 dark:text-white">MediRAG Studio</div>
              <div className="text-[11px] text-slate-500">Grounded answers · live evaluation</div>
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
              onClick={() => {
                setView(n.id);
                onClose();
              }}
              className={cx(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition',
                view === n.id
                  ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              )}
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </button>
          ))}
        </nav>

        <div className="mt-4 px-4">
          <label className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Active manual</label>
          {manuals.length ? (
            <select
              value={activeManual?.id || ''}
              onChange={(e) => setActiveManualId(e.target.value)}
              className="mt-1 w-full truncate rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              {manuals.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          ) : (
            <button onClick={() => setView('library')} className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 hover:border-brand-400 hover:text-brand-700 dark:border-slate-700">
              <BookMarked className="h-4 w-4" /> Add a manual
            </button>
          )}
          {activeManual && (
            <div className="mt-1.5 text-[11px] text-slate-500">
              {activeManual.pageCount?.toLocaleString()} pages · {activeManual.chunkStats?.count?.toLocaleString()} chunks ·{' '}
              {es?.running
                ? `embedding ${Math.round((es.done / es.total) * 100)}%`
                : activeManual.embedDone >= activeManual.chunkStats?.count
                  ? 'semantic ✓'
                  : 'keyword-only'}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between px-4">
          <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Sessions</span>
          <button
            onClick={() => {
              newSession();
              setView('chat');
              onClose();
            }}
            disabled={!activeManual}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-40 dark:text-brand-300 dark:hover:bg-brand-900/30"
          >
            <Plus className="h-3.5 w-3.5" /> New
          </button>
        </div>
        <div className="scroll-thin mt-1 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={cx(
                'group flex items-center rounded-lg pr-1 text-sm',
                s.id === activeSessionId && view === 'chat' ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
              )}
            >
              <button
                className="flex-1 truncate px-3 py-1.5 text-left text-slate-700 dark:text-slate-300"
                onClick={() => {
                  setActiveSessionId(s.id);
                  setView('chat');
                  onClose();
                }}
                title={s.title}
              >
                {s.title}
                <span className="block text-[11px] text-slate-400">
                  {s.messages.length} Q · {new Date(s.updatedAt).toLocaleDateString()}
                </span>
              </button>
              <button
                onClick={() => deleteSession(s.id)}
                className="rounded p-1 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-rose-600"
                aria-label="Delete session"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {activeManual && !sessions.length && <p className="px-3 py-2 text-xs text-slate-400">No sessions yet — ask your first question.</p>}
        </div>
        <div className="border-t border-slate-200 px-4 py-2.5 text-[11px] text-slate-400 dark:border-slate-800">
          All data stays in this browser (IndexedDB). Decision support only — not a substitute for clinical judgement.
        </div>
      </aside>
    </>
  );
}
