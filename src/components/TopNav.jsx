import { useEffect, useRef, useState } from 'react';
import { Sparkles, Moon, Sun, Menu, X, Library, ChevronDown, Check, Plus, Pencil, Trash2, PlusCircle } from 'lucide-react';
import { cx, useDialog } from './ui.jsx';
import { useStore } from '../state/store.jsx';
import { callsPerQuestion } from '../lib/hf.js';
import { PROVIDERS, apiKeyOf, dataClass, dataRecipient } from '../lib/providers.js';

export const NAV = [
  { id: 'chat', label: 'Chat' },
  { id: 'library', label: 'Documents' },
  { id: 'lab', label: 'Evaluation Lab' },
  { id: 'settings', label: 'Settings' },
  { id: 'learn', label: 'Learn RAG' },
];

function CollectionMenu({ onDone }) {
  const s = useStore();
  const dialog = useDialog();
  const { collections, activeCollection, docs } = s;
  return (
    <div className="w-80 p-2 text-sm">
      <div className="px-3 pt-2 pb-1 text-xs font-semibold text-slate-500">Collections</div>
      {collections.map((c) => (
        <div key={c.id} className="group flex items-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800">
          <button className="flex flex-1 items-center gap-2 px-3 py-2 text-left" onClick={() => s.setActiveCollectionId(c.id)}>
            <Check className={cx('h-4 w-4 text-brand-600', c.id === activeCollection?.id ? 'opacity-100' : 'opacity-0')} />
            <span className="flex-1 truncate">{c.name}</span>
            <span className="text-xs text-slate-400">{c.docIds.length}</span>
          </button>
          <button
            className="rounded-full p-1.5 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-ink focus:opacity-100"
            aria-label={`Rename ${c.name}`}
            onClick={async () => {
              const name = await dialog.prompt('New name for this collection', { title: 'Rename collection', defaultValue: c.name });
              if (name) await s.updateCollection({ ...c, name });
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            className="mr-1 rounded-full p-1.5 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-rose-600 focus:opacity-100"
            aria-label={`Delete ${c.name}`}
            onClick={async () => {
              const ok = await dialog.confirm(`Delete “${c.name}” and its chat sessions? The documents themselves stay in your library.`, { title: 'Delete collection', confirmLabel: 'Delete', danger: true });
              if (ok) {
                await s.deleteCollection(c.id);
                dialog.toast(`Deleted “${c.name}”`);
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-brand-700 hover:bg-slate-100 dark:text-brand-400 dark:hover:bg-slate-800"
        onClick={async () => {
          const name = await dialog.prompt('A collection is a set of documents you chat with together.', { title: 'New collection', defaultValue: 'New collection' });
          if (name) await s.createCollection(name);
        }}
      >
        <Plus className="h-4 w-4" /> New collection
      </button>
      {activeCollection && docs.length > 0 && (
        <>
          <div className="mt-2 border-t border-slate-100 px-3 pt-3 pb-1 text-xs font-semibold text-slate-500 dark:border-slate-800">Documents in “{activeCollection.name}”</div>
          <div className="scroll-thin max-h-56 overflow-y-auto">
            {docs.map((d) => {
              const on = activeCollection.docIds.includes(d.id);
              return (
                <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-600"
                    checked={on}
                    onChange={() => s.updateCollection({ ...activeCollection, docIds: on ? activeCollection.docIds.filter((x) => x !== d.id) : [...activeCollection.docIds, d.id] })}
                  />
                  <span className={cx('flex-1 truncate', !on && 'text-slate-400')}>{d.name}</span>
                  <span className={cx('text-[11px]', d.embedDone >= d.chunkStats?.count ? 'text-emerald-600' : 'text-amber-600')}>{d.embedDone >= d.chunkStats?.count ? 'semantic' : 'keyword'}</span>
                </label>
              );
            })}
          </div>
        </>
      )}
      <button
        className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-brand-700 hover:bg-slate-100 dark:text-brand-400 dark:hover:bg-slate-800"
        onClick={() => {
          s.setView('library');
          onDone();
        }}
      >
        <PlusCircle className="h-4 w-4" /> Add documents
      </button>
    </div>
  );
}

/** Context ribbon under the navigation bar: the single most useful next step. */
function Ribbon() {
  const { settings, setView, activeDocs, usage, effectivePlan, hfAccount } = useStore();
  let text;
  let action;
  if (!activeDocs.length) {
    text = 'Chat with any PDF, Word, HTML or Markdown document, processed privately in your browser.';
    action = ['Add a document', 'library'];
  } else if (settings.confidential) {
    text = dataClass(settings) === 'cloud' ? `Confidential mode is on, so ${PROVIDERS[settings.provider].label} is blocked. Nothing leaves this device.` : 'Confidential mode on · nothing leaves this device.';
    action = ['Privacy settings', 'settings'];
  } else if (settings.provider === 'extractive') {
    text = 'Get written answers and LLM evaluation for free with a Hugging Face token. It is never saved.';
    action = ['Set up', 'settings'];
  } else if (settings.provider === 'hf' && !settings.hfToken) {
    text = 'Enter your Hugging Face token to start. It stays in this tab’s memory only.';
    action = ['Add token', 'settings'];
  } else if (PROVIDERS[settings.provider]?.group === 'key' && !apiKeyOf(settings)) {
    text = `Enter your ${PROVIDERS[settings.provider].label} API key to start. It stays in this tab’s memory only.`;
    action = ['Add key', 'settings'];
  } else {
    const per = callsPerQuestion(settings).base;
    const plan = settings.provider === 'hf' ? `${hfAccount?.name ? `${hfAccount.name} · ` : ''}${effectivePlan === 'pro' ? 'PRO' : 'Free'} plan · ` : '';
    const where = dataClass(settings) === 'cloud' ? `excerpts go to ${dataRecipient(settings)} · ` : 'on this device · ';
    text = `${plan}${where}about ${per} LLM call${per === 1 ? '' : 's'} per question · ${usage.visit.calls} used this visit.`;
    if (!plan) text = text[0].toUpperCase() + text.slice(1);
    action = ['See usage', 'settings'];
  }
  return (
    <div className="bg-white px-4 py-3 text-center text-sm text-ink dark:bg-slate-900 dark:text-slate-100">
      {text}{' '}
      <button className="inline-flex items-center gap-1 text-brand-700 hover:underline dark:text-brand-400" onClick={() => setView(action[1])}>
        {action[0]} <PlusCircle className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function TopNav({ dark, toggleDark }) {
  const { view, setView, activeCollection } = useStore();
  const [menu, setMenu] = useState(false);
  const [coll, setColl] = useState(false);
  const collRef = useRef(null);

  useEffect(() => {
    if (!coll) return;
    const close = (e) => !collRef.current?.contains(e.target) && setColl(false);
    const esc = (e) => e.key === 'Escape' && setColl(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [coll]);

  const go = (id) => {
    setView(id);
    setMenu(false);
  };

  return (
    <header className="sticky top-0 z-40">
      <nav className="glass border-b border-black/5 dark:border-white/10" aria-label="Main">
        <div className="mx-auto flex h-12 max-w-[1100px] items-center gap-2 px-4">
          <button onClick={() => go('chat')} className="flex items-center gap-2 pr-2 text-ink dark:text-white" aria-label="RAG AI Studio home">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink text-white dark:bg-white dark:text-ink">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight">RAG AI Studio</span>
          </button>
          <div className="mx-auto hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                aria-current={view === n.id ? 'page' : undefined}
                className={cx('rounded-full px-3 py-1 text-[13px] transition', view === n.id ? 'text-ink dark:text-white' : 'text-slate-600 hover:text-ink dark:text-slate-400 dark:hover:text-white')}
              >
                <span className={cx(view === n.id && 'border-b border-ink pb-0.5 dark:border-white')}>{n.label}</span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1 md:ml-0">
            <div className="relative" ref={collRef}>
              <button
                onClick={() => setColl(!coll)}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] text-slate-600 hover:bg-black/5 hover:text-ink dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                aria-expanded={coll}
                aria-haspopup="menu"
              >
                <Library className="h-4 w-4" />
                <span className="hidden max-w-[140px] truncate sm:inline">{activeCollection?.name || 'Collections'}</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {coll && (
                <div className="absolute right-0 mt-2 rounded-[18px] bg-white shadow-card-hover ring-1 ring-black/5 dark:bg-slate-900 dark:ring-white/10" role="menu">
                  <CollectionMenu onDone={() => setColl(false)} />
                </div>
              )}
            </div>
            <button onClick={toggleDark} className="rounded-full p-1.5 text-slate-600 hover:bg-black/5 hover:text-ink dark:text-slate-300 dark:hover:bg-white/10" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button onClick={() => setMenu(!menu)} className="rounded-full p-1.5 text-slate-600 md:hidden dark:text-slate-300" aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu}>
              {menu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {menu && (
          <div className="border-t border-black/5 px-6 pt-2 pb-6 md:hidden dark:border-white/10">
            {NAV.map((n) => (
              <button key={n.id} onClick={() => go(n.id)} className={cx('headline block w-full py-2 text-left text-2xl', view === n.id ? '' : 'text-slate-500')}>
                {n.label}
              </button>
            ))}
          </div>
        )}
      </nav>
      <Ribbon />
    </header>
  );
}
