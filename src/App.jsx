import { lazy, Suspense, useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from './components/Sidebar.jsx';
import PageViewer from './components/PageViewer.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ChatView from './views/ChatView.jsx';
import LibraryView from './views/LibraryView.jsx';
import { StoreProvider, useStore } from './state/store.jsx';

// Heavier, less-used views are code-split.
const LabView = lazy(() => import('./views/LabView.jsx'));
const SettingsView = lazy(() => import('./views/SettingsView.jsx'));
const LearnView = lazy(() => import('./views/LearnView.jsx'));

function Shell() {
  const { view, settings, setSettings, booted } = useStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const prefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && prefersDark);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  return (
    <div className="flex h-full">
      <Sidebar dark={dark} toggleDark={() => setSettings({ theme: dark ? 'light' : 'dark' })} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 md:hidden dark:border-slate-800 dark:bg-slate-900">
          <button onClick={() => setSidebarOpen(true)} className="rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold">RAG AI Studio</span>
        </div>
        <ErrorBoundary key={view}>
          <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading…</div>}>
            {booted && view === 'chat' && <ChatView />}
            {view === 'library' && <LibraryView />}
            {view === 'lab' && <LabView />}
            {view === 'settings' && <SettingsView />}
            {view === 'learn' && <LearnView />}
          </Suspense>
        </ErrorBoundary>
      </main>
      <PageViewer />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
