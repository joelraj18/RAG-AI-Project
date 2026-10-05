import { Plus, Trash2, X, MessageSquare } from 'lucide-react';
import { cx, useDialog } from './ui.jsx';
import { useStore } from '../state/store.jsx';

/** Chat sessions of the active collection: a column on large screens, a drawer on small ones. */
export default function SessionsRail({ open, onClose }) {
  const { sessions, activeSessionId, setActiveSessionId, newSession, deleteSession, activeCollection } = useStore();
  const dialog = useDialog();
  const pick = (id) => {
    setActiveSessionId(id);
    onClose();
  };
  return (
    <>
      <div className={cx('fixed inset-0 z-30 bg-black/30 backdrop-blur-sm lg:hidden', open ? 'block' : 'hidden')} onClick={onClose} />
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-slate-50 transition-transform lg:static lg:z-0 lg:w-64 lg:translate-x-0 lg:border-r lg:border-black/5 dark:bg-slate-950 lg:dark:border-white/10',
          open ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        )}
        aria-label="Chat sessions"
      >
        <div className="flex items-center justify-between px-5 pt-6 pb-3">
          <h2 className="headline text-lg">Sessions</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                newSession();
                onClose();
              }}
              disabled={!activeCollection}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-sm text-brand-700 hover:bg-white disabled:opacity-40 dark:text-brand-400 dark:hover:bg-slate-900"
            >
              <Plus className="h-4 w-4" /> New
            </button>
            <button onClick={onClose} className="rounded-full p-1.5 text-slate-500 lg:hidden" aria-label="Close sessions">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="scroll-thin flex-1 space-y-1 overflow-y-auto px-3 pb-6">
          {sessions.map((x) => (
            <div key={x.id} className={cx('group flex items-center rounded-2xl pr-1 transition', x.id === activeSessionId ? 'bg-white shadow-card dark:bg-slate-900' : 'hover:bg-white/70 dark:hover:bg-slate-900/60')}>
              <button className="min-w-0 flex-1 px-3 py-2.5 text-left" onClick={() => pick(x.id)} aria-current={x.id === activeSessionId ? 'true' : undefined}>
                <span className="block truncate text-sm text-ink dark:text-slate-100">{x.title}</span>
                <span className="block text-xs text-slate-500">
                  {x.messages.length} question{x.messages.length === 1 ? '' : 's'} · {new Date(x.updatedAt).toLocaleDateString()}
                </span>
              </button>
              <button
                onClick={async () => {
                  if (await dialog.confirm(`Delete the session “${x.title}”?`, { title: 'Delete session', confirmLabel: 'Delete', danger: true })) deleteSession(x.id);
                }}
                className="rounded-full p-1.5 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-rose-600 focus:opacity-100"
                aria-label={`Delete session ${x.title}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {!sessions.length && (
            <div className="flex flex-col items-center px-4 py-10 text-center text-sm text-slate-500">
              <MessageSquare className="mb-2 h-6 w-6" strokeWidth={1.5} />
              No sessions yet. Ask your first question.
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
