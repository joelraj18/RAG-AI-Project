import React, { useCallback, useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import { GlobalNav, Ribbon } from './components/GlobalNav';
import { Toast } from './components/ui';
import { ANALYSIS_VERSION, startAnalysis } from './engine';
import { displayName, formatDuration } from './lib/analysis';
import { buildNotebook, buildReport, downloadBlob, downloadFile } from './lib/exporters';
import { createSampleFile } from './lib/sampleData';
import * as storage from './lib/storage';
import AssistantView from './views/AssistantView';
import AuthView from './views/AuthView';
import DatasetsView from './views/DatasetsView';
import ExplorerView from './views/explorer/ExplorerView';

const TOAST_MS = 4500;
const PROGRESS_INTERVAL_MS = 120;
const ACCEPTED = /\.(csv|tsv|txt)$/i;

const isCurrent = (d) => d.analysis?.version === ANALYSIS_VERSION;

/** Datasets saved by earlier versions kept parsed rows; turn them back into a CSV file to re-analyse. */
const legacyToFile = (d) => {
    const csv = Papa.unparse(d.data, { columns: d.columns });
    const blob = new Blob([csv], { type: 'text/csv' });
    blob.name = d.name;
    return blob;
};

export default function DataMind() {
    const [user, setUser] = useState(storage.getSessionUser);
    const [datasets, setDatasets] = useState([]);
    const [loadingDatasets, setLoadingDatasets] = useState(false);
    const [activeId, setActiveId] = useState(null);
    const [view, setView] = useState('datasets');
    const [explorerTab, setExplorerTab] = useState('overview');
    const [messages, setMessages] = useState([]);
    const [job, setJob] = useState(null);
    const [toast, setToast] = useState(null);
    const progressTimer = useRef(null);
    const latestProgress = useRef(null);

    const activeDataset = datasets.find((d) => d.id === activeId) || null;
    const analysis = activeDataset && isCurrent(activeDataset) ? activeDataset.analysis : null;

    const notify = useCallback((message, type = 'info') => setToast({ message, type, at: Date.now() }), []);

    useEffect(() => {
        if (!toast) return undefined;
        const t = setTimeout(() => setToast(null), TOAST_MS);
        return () => clearTimeout(t);
    }, [toast]);

    useEffect(() => {
        window.scrollTo?.(0, 0);
    }, [view]);

    const email = user?.email;
    useEffect(() => {
        if (!email) return undefined;
        let cancelled = false;
        setLoadingDatasets(true);
        storage.loadDatasets(email).then((saved) => {
            if (cancelled) return;
            // Keep anything added while loading (e.g. a sample opened straight away).
            setDatasets((current) => [...saved, ...current.filter((d) => !saved.some((s) => s.id === d.id))]);
            setLoadingDatasets(false);
        });
        return () => {
            cancelled = true;
        };
    }, [email]);

    useEffect(() => () => clearTimeout(progressTimer.current), []);

    /* ---------- Session ---------- */

    const startSession = (profile, greeting) => {
        setUser(profile);
        setDatasets([]);
        setActiveId(null);
        setView('datasets');
        notify(greeting, 'success');
    };

    const signOut = () => {
        job?.cancel();
        storage.clearSession();
        setUser(null);
        setDatasets([]);
        setActiveId(null);
        setMessages([]);
        notify('You’ve been signed out.');
    };

    /* ---------- Datasets ---------- */

    const openDataset = (dataset) => {
        if (!isCurrent(dataset)) {
            reanalyse(dataset);
            return;
        }
        if (dataset.id !== activeId) {
            setActiveId(dataset.id);
            setMessages([]);
            setExplorerTab('overview');
        }
        setView('explorer');
    };

    const saveDataset = (dataset) => {
        storage.saveDataset(user.email, dataset).then((saved) => {
            const fileStored = saved === 'full';
            setDatasets((current) => current.map((d) => (d.id === dataset.id ? { ...d, unsaved: !saved, fileStored } : d)));
            if (!saved) notify(`“${displayName(dataset.name)}” couldn’t be saved in this browser, so it’s available for this session only.`, 'info');
        });
    };

    const pushProgress = (progress) => {
        latestProgress.current = progress;
        const flush = () => {
            progressTimer.current = null;
            const p = latestProgress.current;
            setJob((j) => (j ? { ...j, progress: p } : j));
        };
        if (progress.phase !== 'scanning') {
            clearTimeout(progressTimer.current);
            flush();
        } else if (!progressTimer.current) {
            progressTimer.current = setTimeout(flush, PROGRESS_INTERVAL_MS);
        }
    };

    const runAnalysis = async (file, existing) => {
        if (job) {
            notify('Please wait for the current analysis to finish, or cancel it.', 'info');
            return;
        }
        const handle = startAnalysis(file, { onProgress: pushProgress });
        setJob({ fileName: file.name, cancel: handle.cancel, progress: { phase: 'reading', bytesDone: 0, bytesTotal: file.size, rows: 0, elapsedMs: 0 } });
        setView('datasets');
        try {
            const result = await handle.promise;
            const dataset = {
                id: existing?.id ?? Date.now(),
                name: file.name,
                size: file.size,
                uploadedAt: existing?.uploadedAt ?? new Date().toISOString(),
                analysis: result,
                file,
            };
            setDatasets((current) => (existing ? current.map((d) => (d.id === dataset.id ? dataset : d)) : [...current, dataset]));
            setActiveId(dataset.id);
            setMessages([]);
            setExplorerTab('overview');
            setView('explorer');
            notify(`All ${result.meta.rows.toLocaleString()} rows analysed in ${formatDuration(result.meta.elapsedMs)}.`, 'success');
            saveDataset(dataset);
        } catch (err) {
            if (err.name === 'AnalysisCancelled') notify('Analysis cancelled.');
            else notify(`Couldn’t analyse “${displayName(file.name)}”: ${err.message}`, 'error');
        } finally {
            clearTimeout(progressTimer.current);
            progressTimer.current = null;
            setJob(null);
        }
    };

    function reanalyse(dataset) {
        if (dataset.data) runAnalysis(legacyToFile(dataset), dataset);
        else if (dataset.file) runAnalysis(dataset.file, dataset);
        else notify('This dataset was saved by an older version without its file. Please upload it again.', 'info');
    }

    const handleFile = (file) => {
        if (!ACCEPTED.test(file.name) && file.type !== 'text/csv') {
            notify('Please choose a .csv, .tsv or .txt file.', 'error');
            return;
        }
        runAnalysis(file);
    };

    const deleteDataset = (dataset) => {
        if (!window.confirm(`Delete “${displayName(dataset.name)}”? This can’t be undone.`)) return;
        storage.deleteDataset(user.email, dataset.id);
        setDatasets((current) => current.filter((d) => d.id !== dataset.id));
        if (dataset.id === activeId) {
            setActiveId(null);
            setMessages([]);
            setView('datasets');
        }
        notify('Dataset deleted.', 'success');
    };

    const exportAs = (kind) => {
        const name = displayName(activeDataset.name);
        if (kind === 'csv') {
            if (!activeDataset.file) {
                notify('The original file isn’t stored in this browser (it was too large). Upload it again to download it.', 'info');
                return;
            }
            downloadBlob(activeDataset.name, activeDataset.file);
        }
        if (kind === 'report') downloadFile(`${name} report.md`, buildReport(analysis), 'text/markdown');
        if (kind === 'notebook') downloadFile(`${name} analysis.ipynb`, buildNotebook(analysis), 'application/x-ipynb+json');
        notify('Download started.', 'success');
    };

    /* ---------- Render ---------- */

    const toastNode = toast && <Toast key={toast.at} message={toast.message} type={toast.type} onClose={() => setToast(null)} />;

    if (!user) {
        return (
            <div className="app app--auth">
                {toastNode}
                <AuthView
                    onSignIn={(creds) => {
                        const profile = storage.signIn(creds);
                        startSession(profile, `Welcome back, ${profile.name}.`);
                    }}
                    onRegister={(details) => {
                        const profile = storage.register(details);
                        startSession(profile, `Welcome to DataMind, ${profile.name}.`);
                    }}
                />
            </div>
        );
    }

    const currentView = analysis && !job ? view : 'datasets';

    return (
        <div className="app">
            {toastNode}
            <GlobalNav view={currentView} onNavigate={setView} hasDataset={!!analysis && !job} user={user} onSignOut={signOut} />
            <Ribbon>Your data never leaves this device. Every row is analysed right in your browser, on all your CPU cores.</Ribbon>

            <main id="main">
                {currentView === 'datasets' && (
                    <DatasetsView
                        datasets={datasets}
                        activeId={activeId}
                        job={job}
                        loading={loadingDatasets}
                        onFile={handleFile}
                        onOpen={openDataset}
                        onDelete={deleteDataset}
                        onSample={() => runAnalysis(createSampleFile())}
                    />
                )}
                {currentView === 'explorer' && (
                    <ExplorerView dataset={activeDataset} analysis={analysis} tab={explorerTab} onTabChange={setExplorerTab} onExport={exportAs} />
                )}
                {currentView === 'assistant' && <AssistantView analysis={analysis} messages={messages} onMessages={setMessages} />}
            </main>

            <footer className="footer">
                <p>DataMind reads every row of your file in your browser, split across your CPU cores. Counts, means, correlations and group statistics are exact; medians and percentiles are exact too, except for fractional columns in very large files (±0.1%).</p>
                <p className="footer__fine">Built with React and Recharts.</p>
            </footer>
        </div>
    );
}
