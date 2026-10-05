import { lazy, Suspense, useEffect } from 'react';
import TopNav from './components/TopNav.jsx';
import { DialogProvider } from './components/ui.jsx';
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
  const prefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && prefersDark);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  return (
    <div className="flex h-full flex-col">
      <TopNav dark={dark} toggleDark={() => setSettings({ theme: dark ? 'light' : 'dark' })} />
      <main className="flex min-h-0 flex-1 flex-col">
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
      <DialogProvider>
        <Shell />
      </DialogProvider>
    </StoreProvider>
  );
}
