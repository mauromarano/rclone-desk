import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import i18n from './i18n';
import LocalizeTree from './i18n/LocalizeTree.jsx';
import {
  ArrowLeft,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  Check,
  ChevronRight,
  ChevronDown,
  Clock3,
  Download,
  Eye,
  EyeOff,
  ChevronUp,
  Copy,
  Database,
  File,
  Files,
  Folder,
  HardDrive,
  Home,
  LoaderCircle,
  Play,
  Pencil,
  Plus,
  Search,
  RefreshCw,
  Settings2,
  TriangleAlert,
  Trash2,
  X,
} from 'lucide-react';
import './style.css';

const api = async (url, options = {}) => {
  const response = await fetch(`/api${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || response.statusText);
  return body;
};

const formatSize = (value) => {
  if (value == null || value < 0) return '—';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = -1;
  do {
    size /= 1024;
    index += 1;
  } while (size >= 1024 && index < units.length - 1);
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat(i18n.language.startsWith('it') ? 'it-IT' : 'en-US', { dateStyle: 'medium' }).format(date);
};

const formatScheduledTime = (value) => {
  if (!value) return '—';
  const [year, month, day] = value.slice(0, 10).split('-');
  const date = new Date(`${year}-${month}-${day}T${value.slice(11, 16)}:00Z`);
  const formattedDate = new Intl.DateTimeFormat(i18n.language.startsWith('it') ? 'it-IT' : 'en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
  return `${formattedDate} · ${value.slice(11, 16)}`;
};

const joinPath = (...parts) => parts.filter(Boolean).join('/');

function ModalBackdrop({ children, onClose }) {
  const backdrop = useRef(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const focusable = () => [...backdrop.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')]
      .filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key === 'Tab') {
        const elements = focusable();
        if (!elements.length) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && document.activeElement === elements[0]) {
          event.preventDefault();
          elements[elements.length - 1].focus();
        } else if (!event.shiftKey && document.activeElement === elements[elements.length - 1]) {
          event.preventDefault();
          elements[0].focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return <LocalizeTree><div ref={backdrop} className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>{children}</div></LocalizeTree>;
}

function App() {
  const { i18n, t } = useTranslation('ui');
  const [remotes, setRemotes] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [providers, setProviders] = useState([]);
  const [health, setHealth] = useState(null);
  const [operations, setOperations] = useState([]);
  const [view, setView] = useState('browser');
  const [panes, setPanes] = useState([
    { remote: '', path: '', entries: [] },
    { remote: '', path: '', entries: [] },
  ]);
  const [transferMode, setTransferMode] = useState('move');
  const [editingRemote, setEditingRemote] = useState(null);
  const [editingJob, setEditingJob] = useState(null);
  const [deletingJob, setDeletingJob] = useState(null);
  const [remoteReturnView, setRemoteReturnView] = useState('settings');
  const [pendingSyncJob, setPendingSyncJob] = useState(null);
  const [pendingFileDeletion, setPendingFileDeletion] = useState(null);
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancellingOperation, setCancellingOperation] = useState(null);
  const [dropTarget, setDropTarget] = useState(-1);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState('');
  const [explorer, setExplorer] = useState({ remote: '', path: '', entries: [] });
  const [explorerTarget, setExplorerTarget] = useState('');
  const [explorerTargetPath, setExplorerTargetPath] = useState('');
  const [explorerMode, setExplorerMode] = useState('copy');
  const noticeTimer = useRef(null);
  const operationStatuses = useRef({});
  const explorerRequestId = useRef(0);
  const hasActiveOperations = operations.some((operation) => ['queued', 'running'].includes(operation.status));
  const scheduledRunTimes = jobs
    .filter((job) => job.schedule_enabled && job.next_run)
    .map((job) => Date.parse(job.next_run))
    .filter(Number.isFinite);
  const nextScheduledRun = scheduledRunTimes.length ? Math.min(...scheduledRunTimes) : null;

  const flash = (message) => {
    window.clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4200);
  };

  const refresh = async () => {
    try {
      const [remoteRows, jobRows] = await Promise.all([api('/remotes'), api('/jobs')]);
      setRemotes(remoteRows);
      setJobs(jobRows);
      setPanes((current) => current.map((pane, index) => ({
        ...pane,
        remote: remoteRows.some((remote) => remote.name === pane.remote)
          ? pane.remote
          : remoteRows[index]?.name || remoteRows[0]?.name || '',
      })));
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  useEffect(() => {
    refresh();
    api('/providers').then((result) => setProviders(result.providers || [])).catch(() => {});
    api('/health').then(setHealth).catch(() => setHealth(null));
    return () => window.clearTimeout(noticeTimer.current);
  }, []);

  useEffect(() => {
    let mounted = true;
    api('/operations').then((rows) => {
      if (!mounted) return;
      rows.forEach((operation) => { operationStatuses.current[operation.id] = operation.status; });
      setOperations(rows);
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!hasActiveOperations) return undefined;
    let mounted = true;
    let timer;
    const poll = async () => {
      try {
        const rows = await api('/operations');
        if (!mounted) return;
        setOperations(rows);
        const active = rows.some((operation) => ['queued', 'running'].includes(operation.status));
        for (const operation of rows) {
          const previous = operationStatuses.current[operation.id];
          if (['queued', 'running'].includes(previous) && ['success', 'failed'].includes(operation.status)) {
            refresh();
            panes.forEach((pane, index) => pane.remote && loadPane(index, pane.remote, pane.path));
            if (explorer.remote) loadExplorer(explorer.remote, explorer.path);
            if (operation.status === 'success') flash(t('operation_complete', { label: operation.label }));
            else setError(`${operation.label}: ${operation.message}`);
          }
          operationStatuses.current[operation.id] = operation.status;
        }
        if (mounted && active) timer = window.setTimeout(poll, 1000);
      } catch {
        // Keep the last known operation status visible when the API is briefly unavailable.
        if (mounted) timer = window.setTimeout(poll, 1000);
      }
    };
    poll();
    return () => { mounted = false; window.clearTimeout(timer); };
  }, [explorer.remote, explorer.path, panes, hasActiveOperations]);

  useEffect(() => {
    if (hasActiveOperations || nextScheduledRun == null) return undefined;
    let mounted = true;
    const delay = Math.max(0, nextScheduledRun - Date.now() + 10_000);
    const timer = window.setTimeout(async () => {
      try {
        const rows = await api('/operations');
        if (!mounted) return;
        rows.forEach((operation) => { operationStatuses.current[operation.id] = operation.status; });
        setOperations(rows);
        await refresh();
      } catch {
        if (mounted) refresh();
      }
    }, delay);
    return () => { mounted = false; window.clearTimeout(timer); };
  }, [hasActiveOperations, nextScheduledRun]);

  const setPane = (index, patch) => {
    setPanes((current) => current.map((pane, paneIndex) => (
      paneIndex === index ? { ...pane, ...patch } : pane
    )));
  };

  const loadPane = async (index, remote = panes[index].remote, path = panes[index].path) => {
    if (!remote) {
      setPane(index, { remote: '', path, entries: [] });
      return;
    }
    try {
      const result = await api(`/browse/${encodeURIComponent(remote)}?path=${encodeURIComponent(path)}`);
      setPanes((current) => current.map((pane, paneIndex) => (
        paneIndex === index ? { ...pane, remote, path, entries: result.entries } : pane
      )));
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const loadExplorer = async (remote = explorer.remote, path = explorer.path) => {
    if (!remote) return;
    const requestId = explorerRequestId.current + 1;
    explorerRequestId.current = requestId;
    setExplorer({ remote, path, entries: [], loading: true });
    try {
      const result = await api(`/browse/${encodeURIComponent(remote)}?path=${encodeURIComponent(path)}`);
      if (explorerRequestId.current === requestId) setExplorer({ remote, path, entries: result.entries, loading: false });
    } catch (requestError) {
      if (explorerRequestId.current === requestId) {
        setExplorer({ remote, path, entries: [], loading: false });
        setError(requestError.message);
      }
    }
  };

  const trackOperations = (rows) => {
    if (!rows.length) return;
    rows.forEach((operation) => { operationStatuses.current[operation.id] = operation.status; });
    setOperations((current) => {
      const byId = new Map(current.map((operation) => [operation.id, operation]));
      rows.forEach((operation) => byId.set(operation.id, { ...byId.get(operation.id), ...operation }));
      return [...byId.values()];
    });
  };

  const openExplorer = (remote) => {
    setExplorer({ remote, path: '', entries: [] });
    setExplorerTarget(remotes.find((item) => item.name !== remote)?.name || '');
    setExplorerTargetPath('');
    setView('explorer');
    loadExplorer(remote, '');
  };

  useEffect(() => {
    panes.forEach((pane, index) => {
      if (pane.remote) loadPane(index, pane.remote, pane.path);
    });
  }, [remotes.map((remote) => remote.name).join('\u0000')]);

  const transfer = async (sourceIndex, entry, destinationIndex, mode = transferMode) => {
    const source = panes[sourceIndex];
    const destination = panes[destinationIndex];
    if (!source.remote || !destination.remote) {
      setError('Seleziona un remote sorgente e uno di destinazione.');
      return;
    }
    if (sourceIndex === destinationIndex) {
      setError('Rilascia il file nel pannello del remote di destinazione.');
      return;
    }

    const sourcePath = joinPath(source.path, entry.name);
    const destinationPath = joinPath(destination.path, entry.name);
    setBusy(true);
    setError('');
    try {
      const operation = await api('/transfer', {
        method: 'POST',
        body: JSON.stringify({
          source_remote: source.remote,
          source_path: sourcePath,
          destination_remote: destination.remote,
          destination_path: destinationPath,
          mode,
        }),
      });
      flash(t('transfer_started', { action: t(mode === 'copy' ? 'Copy' : 'Move'), name: entry.name }));
      trackOperations([operation]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
      setDropTarget(-1);
    }
  };

  const transferExplorerEntries = async (entries, mode = explorerMode) => {
    if (!explorerTarget) {
      setError('Scegli un remote di destinazione.');
      return;
    }
    setError('');
    const results = await Promise.allSettled(entries.map(async (entry) => {
      const operation = await api('/transfer', {
        method: 'POST',
        body: JSON.stringify({ source_remote: explorer.remote, source_path: entry.path,
          destination_remote: explorerTarget, destination_path: joinPath(explorerTargetPath, entry.name), mode }),
      });
      return operation;
    }));
    const started = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results.length - started;
    trackOperations(results.filter((result) => result.status === 'fulfilled').map((result) => result.value));
    if (started) {
      const verb = mode === 'copy' ? 'copy_count_started' : 'move_count_started';
      flash(`${t(verb, { count: started })}${failed ? t('failed_count_suffix', { count: failed }) : ''}`);
    }
    const firstFailure = results.find((result) => result.status === 'rejected');
    if (firstFailure) setError(firstFailure.reason.message);
  };

  const createBucket = async (name) => {
    await api(`/buckets/${encodeURIComponent(explorer.remote)}`, {
      method: 'POST', body: JSON.stringify({ name }),
    });
    await loadExplorer(explorer.remote, '');
    flash(t('bucket_created', { name, remote: explorer.remote }));
    return true;
  };

  const downloadExplorerEntries = async (entries) => {
    const paths = entries.filter((entry) => !entry.is_dir).map((entry) => entry.path);
    if (!paths.length) {
      setError('Seleziona almeno un file; le cartelle non possono essere scaricate come archivio.');
      return;
    }
    if (paths.length === 1) {
      const link = document.createElement('a');
      link.href = `/api/download/${encodeURIComponent(explorer.remote)}?path=${encodeURIComponent(paths[0])}`;
      link.click();
      flash(t('Download started.'));
      return;
    }
    try {
      const response = await fetch(`/api/download/${encodeURIComponent(explorer.remote)}/archive`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || response.statusText);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `${explorer.remote}-files.zip`;
      link.click();
      URL.revokeObjectURL(url);
      flash(t('download_ready', { count: paths.length }));
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const requestFileDeletion = (entries) => {
    if (entries.length) setPendingFileDeletion({ entries, stage: 1 });
  };

  const confirmFileDeletion = async () => {
    if (!pendingFileDeletion || deletionBusy) return;
    setDeletionBusy(true);
    setError('');
    try {
      const result = await api(`/delete/${encodeURIComponent(explorer.remote)}`, {
        method: 'POST', body: JSON.stringify({ paths: pendingFileDeletion.entries.map((entry) => entry.path) }),
      });
      trackOperations(result.operations);
      setPendingFileDeletion(null);
      flash(t('deletion_started', { count: result.operations.length }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDeletionBusy(false);
    }
  };

  const handleDrop = (event, destinationIndex) => {
    event.preventDefault();
    setDropTarget(-1);
    try {
      const payload = JSON.parse(event.dataTransfer.getData('application/json') || '{}');
      if (payload.entry && Number.isInteger(payload.pane)) {
        transfer(payload.pane, payload.entry, destinationIndex, payload.mode || transferMode);
      }
    } catch {
      setError('Impossibile leggere il file trascinato. Riprova oppure usa il pulsante nella riga.');
    }
  };

  const saveRemote = async (form) => {
    try {
      await api('/remotes', { method: 'POST', body: JSON.stringify(form) });
      setEditingRemote(null);
      await refresh();
      setView(remoteReturnView);
      flash(t('Remote saved.'));
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const saveJob = async (job) => {
    const editing = Boolean(job.id);
    try {
      await api(editing ? `/jobs/${job.id}` : '/jobs', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(job) });
      setEditingJob(null);
      setView('jobs');
      await refresh();
      flash(editing ? t('Job updated.') : t('Job created.'));
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const deleteJob = async () => {
    if (!deletingJob) return;
    try {
      await api(`/jobs/${deletingJob.id}`, { method: 'DELETE' });
      setDeletingJob(null);
      await refresh();
      flash(t('job_deleted', { name: deletingJob.name }));
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const openJobEditor = (job = null) => {
    setEditingJob(job);
    setView('job-editor');
  };

  const runJob = async (job, confirmed = false) => {
    if (job.mode === 'sync' && !confirmed) {
      setPendingSyncJob(job);
      return;
    }
    setBusy(true);
    setPendingSyncJob(null);
    setError('');
    try {
      const result = await api(`/jobs/${job.id}/run`, {
        method: 'POST',
        body: JSON.stringify({ confirm_sync_deletions: job.mode === 'sync' && confirmed }),
      });
      trackOperations([{ id: result.operation_id, label: t('Job: {{name}}', { name: job.name }), status: 'queued', percentage: null, message: 'In attesa' }]);
      flash(t('job_started', { name: job.name }));
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const openAddRemote = () => {
    setRemoteReturnView(view);
    setEditingRemote(null);
    setView('remote');
  };

  const openEditRemote = (remote) => {
    setRemoteReturnView(view);
    setEditingRemote(remote);
    setView('remote');
  };

  const closeRemoteEditor = () => {
    setEditingRemote(null);
    setView(remoteReturnView);
  };

  return (<LocalizeTree>
    <LocalizeTree><div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#browser" onClick={(event) => { event.preventDefault(); setView('browser'); }}>
          <span className="brand-mark"><img src="/images/rclone-desk-mark.svg" alt="" /></span>
          <span>Rclone<span className="brand-light"> Desk</span></span>
        </a>

        <nav className="primary-nav" aria-label="Navigazione principale">
          <p className="nav-label">Workspace</p>
          <button className={`nav-item ${view === 'browser' ? 'is-active' : ''}`} onClick={() => setView('browser')}>
            <Files size={17} /><span>Trasferimenti</span>
          </button>
          <button className={`nav-item ${view === 'jobs' || view === 'job-editor' ? 'is-active' : ''}`} onClick={() => setView('jobs')}>
            <Clock3 size={17} /><span>Job di sincronizzazione</span>
            {jobs.length > 0 && <span className="nav-count">{jobs.length}</span>}
          </button>
          <button className={`nav-item ${view === 'settings' || view === 'remote' ? 'is-active' : ''}`} onClick={() => setView('settings')}>
            <Settings2 size={17} /><span>Configurazione</span>
          </button>
        </nav>

        <div className="sidebar-remotes">
          <div className="sidebar-heading"><span>Remote</span><button className="icon-button small" aria-label="Aggiungi remote" onClick={openAddRemote}><Plus size={15} /></button></div>
          {remotes.map((remote) => (
            <button key={remote.name} className={`remote-nav ${view === 'explorer' && explorer.remote === remote.name ? 'is-active' : ''}`} onClick={() => openExplorer(remote.name)}>
              <HardDrive size={15} /><span data-user-content>{remote.name}</span>{remote.test && <span className="test-mark">TEST</span>}
            </button>
          ))}
          {!remotes.length && <p className="sidebar-empty">Aggiungi un remote per iniziare.</p>}
        </div>

        <div className="sidebar-bottom">
          <div className="engine-status"><span className={`status-dot ${health ? 'is-online' : ''}`} />
            <span>{health ? `rclone ${health.rclone.replace('rclone ', '')}` : 'Connessione rclone'}</span>
          </div>
          <p>Rclone Desk · archivio privato</p>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumbs-top"><span>Rclone Desk</span><ChevronRight size={14} /><span data-user-content={view === 'explorer' ? '' : undefined}>{view === 'browser' ? 'Trasferimenti' : view === 'explorer' ? explorer.remote : view === 'jobs' ? 'Job' : view === 'job-editor' ? (editingJob ? 'Modifica job' : 'Nuovo job') : view === 'remote' ? (editingRemote ? 'Modifica remote' : 'Nuovo remote') : 'Configurazione'}</span></div>
          <div className="topbar-actions">
            {health && <span className="connected-label"><span className="status-dot is-online" />Connesso</span>}
            <button className="icon-button" aria-label="Aggiorna" title="Aggiorna" onClick={refresh}><RefreshCw size={16} /></button>
          </div>
        </header>

        <main className="page-content">
          {error && <div className="alert alert-error" role="alert"><TriangleAlert size={17} /><span>{error}</span><button className="icon-button small" aria-label="Chiudi errore" onClick={() => setError('')}><X size={16} /></button></div>}
          {notice && <div className="toast" role="status"><Check size={16} /><span>{notice}</span><button className="icon-button small" aria-label="Chiudi notifica" onClick={() => setNotice(null)}><X size={15} /></button></div>}

          {view === 'browser' && (
            <TransferWorkspace
              panes={panes}
              remotes={remotes}
              mode={transferMode}
              busy={busy}
              dropTarget={dropTarget}
              onModeChange={setTransferMode}
              onSwapPanes={() => setPanes(([first, second]) => [second, first])}
              onRemoteChange={(index, remote) => {
                setPane(index, { remote, path: '', entries: [] });
                loadPane(index, remote, '');
              }}
              onNavigate={loadPane}
              onTransfer={transfer}
              onDrop={handleDrop}
              onDragEnter={setDropTarget}
              onDragLeave={() => setDropTarget(-1)}
              onRefresh={loadPane}
              onAddRemote={openAddRemote}
            />
          )}

          {view === 'explorer' && (
            <FileExplorerWorkspace
              explorer={explorer}
              remotes={remotes}
              target={explorerTarget}
              onRemoteChange={(remote) => { setExplorerTarget(remotes.find((item) => item.name !== remote)?.name || ''); setExplorerTargetPath(''); loadExplorer(remote, ''); }}
              targetPath={explorerTargetPath}
              mode={explorerMode}
              busy={busy}
              onNavigate={loadExplorer}
              onRefresh={() => loadExplorer(explorer.remote, explorer.path)}
              onTargetChange={setExplorerTarget}
              onTargetPathChange={setExplorerTargetPath}
              onModeChange={setExplorerMode}
              onTransfer={(entry) => transferExplorerEntries([entry])}
              onTransferSelected={(entries) => transferExplorerEntries(entries)}
              onDownloadSelected={downloadExplorerEntries}
              onDelete={requestFileDeletion}
              onCreateBucket={createBucket}
            />
          )}

          {view === 'jobs' && (
            <JobsWorkspace jobs={jobs} remotes={remotes} busy={busy} onCreate={() => openJobEditor()} onEdit={openJobEditor} onDelete={setDeletingJob} onRun={runJob} />
          )}

          {view === 'job-editor' && (
            <JobWorkspace key={editingJob?.id || 'new-job'} remotes={remotes} job={editingJob} onCancel={() => { setEditingJob(null); setView('jobs'); }} onSubmit={saveJob} />
          )}

          {view === 'settings' && (
            <SettingsWorkspace
              remotes={remotes}
              onAdd={openAddRemote}
              onEdit={openEditRemote}
              flash={flash}
              setError={setError}
              refresh={refresh}
              language={i18n.language}
              onLanguageChange={(language) => {
                window.localStorage.setItem('rclone-desk-language', language);
                i18n.changeLanguage(language);
              }}
            />
          )}

          {view === 'remote' && (
            <RemoteWorkspace
              providers={providers}
              remote={editingRemote}
              onCancel={closeRemoteEditor}
              onSubmit={saveRemote}
            />
          )}
        </main>
      </div>

      {pendingSyncJob && (
        <SyncConfirm job={pendingSyncJob} busy={busy} onCancel={() => setPendingSyncJob(null)} onConfirm={() => runJob(pendingSyncJob, true)} />
      )}
      {deletingJob && <DeleteJobConfirm job={deletingJob} onCancel={() => setDeletingJob(null)} onConfirm={deleteJob} />}
      {pendingFileDeletion && <DeleteFilesConfirm key={pendingFileDeletion.stage} deletion={pendingFileDeletion} busy={deletionBusy} onCancel={() => setPendingFileDeletion(null)} onContinue={() => setPendingFileDeletion((current) => current && ({ ...current, stage: 2 }))} onBack={() => setPendingFileDeletion((current) => current && ({ ...current, stage: 1 }))} onConfirm={confirmFileDeletion} remote={explorer.remote} />}
      <OperationsTray operations={operations.filter((operation) => ['queued', 'running'].includes(operation.status))} cancelling={cancellingOperation} onCancel={async (id) => {
        setCancellingOperation(id);
        try {
          await api(`/operations/${id}/cancel`, { method: 'POST' });
        } catch (requestError) {
          setError(requestError.message);
        } finally {
          setCancellingOperation(null);
        }
      }} />
    </div></LocalizeTree>
  </LocalizeTree>);
}

function FileExplorerWorkspace({ explorer, remotes, target, targetPath, mode, busy, onNavigate, onRefresh, onRemoteChange, onTargetChange, onTargetPathChange, onModeChange, onTransfer, onTransferSelected, onDownloadSelected, onDelete, onCreateBucket }) {
  const { t } = useTranslation('ui');
  const [showCreateBucket, setShowCreateBucket] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState(() => new Set());
  const segments = explorer.path ? explorer.path.split('/') : [];
  const sortedEntries = [...explorer.entries].sort((a, b) => a.is_dir !== b.is_dir ? (a.is_dir ? -1 : 1) : a.name.localeCompare(b.name, 'it', { numeric: true, sensitivity: 'base' }));
  const selectedEntries = sortedEntries.filter((entry) => selectedPaths.has(entry.path));
  const selectedFiles = selectedEntries.filter((entry) => !entry.is_dir);
  const allSelected = sortedEntries.length > 0 && sortedEntries.every((entry) => selectedPaths.has(entry.path));
  const destinationChoices = remotes.filter((remote) => remote.name !== explorer.remote);
  useEffect(() => setSelectedPaths(new Set()), [explorer.remote, explorer.path]);
  return (<LocalizeTree>
    <section className="workspace-view" aria-labelledby="explorer-title">
      <div className="page-heading explorer-heading">
        <div><h1 id="explorer-title" data-user-content>{explorer.remote || 'Esplora remote'}</h1><p>Esplora cartelle e file, poi copiali o spostali verso un altro remote.</p></div>
        <div className="explorer-heading-actions">
          {explorer.path === '' && remotes.find((remote) => remote.name === explorer.remote)?.bucket_supported && <button className="secondary-button" onClick={() => setShowCreateBucket(true)}><Plus size={15} />Nuovo bucket</button>}
          <button className="secondary-button" onClick={onRefresh}><RefreshCw size={15} />Aggiorna</button>
        </div>
      </div>
      <section className="explorer-toolbar" aria-label="Trasferimento dal remote">
        <label className="form-field explorer-source"><span>Remote aperto</span><select value={explorer.remote} onChange={(event) => onRemoteChange(event.target.value)}>{remotes.map((remote) => <option data-user-content key={remote.name} value={remote.name}>{remote.name}</option>)}</select></label>
        <label className="form-field explorer-destination"><span>Destinazione</span><select value={target} onChange={(event) => onTargetChange(event.target.value)}>
          <option value="">Scegli un remote</option>{destinationChoices.map((remote) => <option data-user-content key={remote.name} value={remote.name}>{remote.name}</option>)}
        </select></label>
        <label className="form-field explorer-destination-path"><span>Cartella di destinazione</span><input value={targetPath} onChange={(event) => onTargetPathChange(event.target.value)} placeholder="Radice del remote" /></label>
        <div className="segmented-control" role="group" aria-label="Azione sui file">
          <button className={mode === 'copy' ? 'selected' : ''} aria-pressed={mode === 'copy'} onClick={() => onModeChange('copy')}><Copy size={14} />Copia</button>
          <button className={mode === 'move' ? 'selected' : ''} aria-pressed={mode === 'move'} onClick={() => onModeChange('move')}><ArrowRight size={14} />Sposta</button>
        </div>
      </section>
      <section className="explorer-pane" aria-label={`File in ${explorer.remote}`}>
        <header className="explorer-pathbar" aria-busy={explorer.loading}>
          <nav className="path-crumbs" aria-label="Percorso remoto">
            <button onClick={() => onNavigate(explorer.remote, '')} aria-label="Radice"><Home size={14} /><span data-user-content>{explorer.remote || 'Root'}</span></button>
            {segments.map((segment, index) => <React.Fragment key={`${segment}-${index}`}><ChevronRight size={13} /><button data-user-content onClick={() => onNavigate(explorer.remote, segments.slice(0, index + 1).join('/'))}>{segment}</button></React.Fragment>)}
          </nav>
          <span className="explorer-count">{explorer.loading ? <><LoaderCircle size={12} className="explorer-count-spinner" />{t('Reading…')}</> : t('item_count', { count: explorer.entries.length })}</span>
        </header>
        {selectedEntries.length > 0 && <div className="selection-toolbar" role="region" aria-label="Azioni sugli elementi selezionati">
          <span><strong>{selectedEntries.length}</strong> {t('selected_item_count', { count: selectedEntries.length })}</span>
          <div className="selection-actions">
            <button className="secondary-button compact" disabled={busy || !target} onClick={() => { onTransferSelected(selectedEntries); setSelectedPaths(new Set()); }}>{mode === 'copy' ? <Copy size={14} /> : <ArrowRight size={14} />}{mode === 'copy' ? 'Copia' : 'Sposta'}</button>
            <button className="secondary-button compact" disabled={!selectedFiles.length} onClick={() => onDownloadSelected(selectedFiles)}><Download size={14} />Scarica {selectedFiles.length ? `(${selectedFiles.length})` : ''}</button>
            <button className="danger-button compact delete-selected-button" disabled={selectedEntries.length > 200} onClick={() => onDelete(selectedEntries)}><Trash2 size={14} />Elimina ({selectedEntries.length})</button>
            <button className="text-button" onClick={() => setSelectedPaths(new Set())}>Deseleziona</button>
          </div>
          {selectedFiles.length < selectedEntries.length && <small className="selection-note">Le cartelle selezionate non verranno incluse nel download.</small>}
          {selectedEntries.length > 200 && <small className="selection-note">Puoi eliminare al massimo 200 elementi per volta.</small>}
        </div>}
        <div className="explorer-table-scroll" aria-busy={explorer.loading}>
          <table className="file-table explorer-table">
            <thead><tr><th scope="col" className="selection-column"><input type="checkbox" aria-label="Seleziona tutti gli elementi" checked={allSelected} onChange={(event) => setSelectedPaths(event.target.checked ? new Set(sortedEntries.map((entry) => entry.path)) : new Set())} /></th><th scope="col">Nome</th><th scope="col" className="size-column">Dimensione</th><th scope="col" className="type-column">Tipo</th><th scope="col" className="date-column">Modificato</th><th scope="col" className="explorer-actions-column"><span className="sr-only">Azioni</span></th></tr></thead>
            <tbody>
              {explorer.path && <tr className="parent-row"><td colSpan="6"><button onClick={() => onNavigate(explorer.remote, segments.slice(0, -1).join('/'))}><ArrowRight size={14} className="up-icon" />Cartella superiore</button></td></tr>}
              {sortedEntries.map((entry) => <tr key={entry.path} className="file-row">
                <td className="selection-column"><input type="checkbox" aria-label={t('Select {{name}}', { name: entry.name })} checked={selectedPaths.has(entry.path)} onChange={(event) => setSelectedPaths((current) => { const next = new Set(current); if (event.target.checked) next.add(entry.path); else next.delete(entry.path); return next; })} /></td>
                <td className="name-cell"><button className="file-name-button" onClick={() => entry.is_dir && onNavigate(explorer.remote, entry.path)} title={entry.is_dir ? t('Open {{name}}', { name: entry.name }) : entry.name}>{entry.is_dir ? <Folder size={17} className="folder-icon" /> : <File size={17} className="file-icon" />}<span data-user-content>{entry.name}</span></button></td>
                <td className="size-column">{entry.is_dir ? '—' : formatSize(entry.size)}</td><td className="type-column">{entry.is_dir ? 'Cartella' : 'File'}</td><td className="date-column">{formatDate(entry.mod_time)}</td>
                <td className="explorer-actions-column"><div className="explorer-row-actions">
                  <button className="row-action" disabled={busy || !target} onClick={() => onTransfer(entry)} aria-label={t(mode === 'copy' ? 'Copy {{name}} to {{destination}}' : 'Move {{name}} to {{destination}}', { name: entry.name, destination: target || t('another remote') })} title={t(mode === 'copy' ? 'Copy to {{destination}}' : 'Move to {{destination}}', { destination: target || t('another remote') })}>{mode === 'copy' ? <Copy size={15} /> : <ArrowRight size={15} />}<span>{mode === 'copy' ? 'Copia' : 'Sposta'}</span></button>
                  {!entry.is_dir && <a className="row-action download-action" href={`/api/download/${encodeURIComponent(explorer.remote)}?path=${encodeURIComponent(entry.path)}`} aria-label={t('Download {{name}}', { name: entry.name })} title="Scarica sul desktop"><Download size={15} /><span>Scarica</span></a>}
                  <button className="row-action delete-row-action" onClick={() => onDelete([entry])} aria-label={t('Delete {{name}}', { name: entry.name })} title="Elimina elemento"><Trash2 size={15} /><span>Elimina</span></button>
                </div></td>
              </tr>)}
            </tbody>
          </table>
          {!sortedEntries.length && (explorer.loading ? <div className="explorer-loading" role="status" aria-live="polite">
            <div className="explorer-loading-message"><LoaderCircle size={17} className="explorer-loading-spinner" /><span>{t('Loading files from')} <strong data-user-content>{explorer.remote}</strong>…</span></div>
            <div className="explorer-skeleton" aria-hidden="true">
              {[0, 1, 2, 3].map((row) => <div key={row} className="explorer-skeleton-row"><span className="explorer-skeleton-icon" /><span className="explorer-skeleton-name" /><span className="explorer-skeleton-meta" /></div>)}
            </div>
          </div> : <div className="explorer-empty"><Folder size={25} /><strong>{explorer.path ? 'Cartella vuota' : 'Remote vuoto'}</strong><span>Non ci sono elementi in questo percorso.</span></div>)}
        </div>
        {mode === 'move' && <p className="explorer-note"><TriangleAlert size={14} />Sposta elimina la sorgente solo dopo il trasferimento riuscito.</p>}
      </section>
      {showCreateBucket && <CreateBucketDialog remote={explorer.remote} onCancel={() => setShowCreateBucket(false)} onCreate={onCreateBucket} />}
    </section>
  </LocalizeTree>);
}

function CreateBucketDialog({ remote, onCancel, onCreate }) {
  const { t } = useTranslation('ui');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const created = await onCreate(name.trim());
      if (created) onCancel();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  return <LocalizeTree><ModalBackdrop onClose={saving ? () => {} : onCancel}><section className="dialog create-bucket-dialog" role="dialog" aria-modal="true" aria-labelledby="create-bucket-title">
    <div className="dialog-heading"><div><h2 id="create-bucket-title">Crea un bucket</h2><p>{t('bucket_create_explanation', { remote })}</p></div><button type="button" className="icon-button" onClick={onCancel} disabled={saving} aria-label="Chiudi"><X size={17} /></button></div>
    <form onSubmit={submit}>
      <div className="form-field"><label htmlFor="bucket-name">Nome bucket</label><input id="bucket-name" autoComplete="off" autoCapitalize="none" spellCheck="false" required maxLength={255} value={name} onChange={(event) => setName(event.target.value)} placeholder="es. archivio-documenti" /><span>Il nome deve rispettare le regole del provider. Servono credenziali con permesso di creazione.</span></div>
      {error && <p className="create-bucket-error" role="alert"><Database size={15} />{error}</p>}
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>Annulla</button><button type="submit" className="primary-button" disabled={saving || !name.trim()}>{saving ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}Crea bucket</button></div>
    </form>
  </section></ModalBackdrop></LocalizeTree>;
}

function OperationsTray({ operations, cancelling, onCancel }) {
  if (!operations.length) return null;
  return (<LocalizeTree>
    <section className="operations-tray" aria-label="Operazioni in corso" aria-live="polite">
      {operations.map((operation) => <article className="operation-item" key={operation.id}>
        <div className="operation-heading"><LoaderCircle size={16} className="spin" /><strong data-user-content>{operation.label}</strong><span>{operation.percentage == null ? 'In corso' : `${operation.percentage}%`}</span><button className="text-button" type="button" disabled={cancelling === operation.id} onClick={() => onCancel(operation.id)}>{cancelling === operation.id ? 'Cancelling…' : 'Cancel'}</button></div>
        <div className={`operation-progress ${operation.percentage == null ? 'indeterminate' : ''}`} role="progressbar" aria-label={`Avanzamento ${operation.label}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={operation.percentage ?? undefined}><span style={operation.percentage == null ? undefined : { width: `${operation.percentage}%` }} /></div>
        <div className="operation-details"><span>{operation.percentage == null ? (operation.total_transfers ? t('transfer_count', { count: operation.transfers, total: operation.total_transfers }) : 'Calcolo avanzamento…') : t('progress_size', { current: formatSize(operation.bytes), total: formatSize(operation.total_bytes) })}</span>{operation.speed > 0 && <span>{formatSize(operation.speed)}/s</span>}</div>
      </article>)}
    </section>
  </LocalizeTree>);
}

function TransferWorkspace({ panes, remotes, mode, busy, dropTarget, onModeChange, onSwapPanes, onRemoteChange, onNavigate, onTransfer, onDrop, onDragEnter, onDragLeave, onRefresh, onAddRemote }) {
  const { t } = useTranslation('ui');
  return (<LocalizeTree>
    <section className="workspace-view" aria-labelledby="transfer-title">
      <div className="page-heading transfer-heading">
        <div><h1 id="transfer-title">Trasferisci file</h1><p>Scegli due remote e trascina i file da uno all’altro.</p></div>
        <button className="secondary-button" onClick={onSwapPanes} aria-label="Inverti sorgente e destinazione">
          <ArrowLeftRight size={16} /><span className="swap-label-full">Inverti pannelli</span><span className="swap-label-short">Inverti</span>
        </button>
      </div>

      <section className="transfer-toolbar" aria-label="Azione di trasferimento">
        <div className="mode-copy">
          <span className="field-label">Quando trascini un elemento</span>
          <p>{mode === 'move' ? 'Sposta: rimuove l’originale dopo il trasferimento.' : 'Copia: conserva l’originale nel remote sorgente.'}</p>
        </div>
        <div className="segmented-control" role="group" aria-label="Modalità di trasferimento">
          <button className={mode === 'move' ? 'selected' : ''} aria-pressed={mode === 'move'} onClick={() => onModeChange('move')}><ArrowRight size={15} />Sposta</button>
          <button className={mode === 'copy' ? 'selected' : ''} aria-pressed={mode === 'copy'} onClick={() => onModeChange('copy')}><Copy size={15} />Copia</button>
        </div>
        <span className={`mode-tag ${mode}`}>{mode === 'move' ? 'Rimuove la sorgente' : 'Mantiene la sorgente'}</span>
      </section>

      <div className="panes-grid">
        {panes.map((pane, index) => (
          <FilePane
            key={index}
            index={index}
            pane={pane}
            remotes={remotes}
            mode={mode}
            busy={busy}
            isDropTarget={dropTarget === index}
            onRemoteChange={onRemoteChange}
            onNavigate={onNavigate}
            onTransfer={onTransfer}
            onDrop={onDrop}
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onRefresh={onRefresh}
            onAddRemote={onAddRemote}
          />
        ))}
      </div>
      <p className="transfer-help"><span className="help-symbol">i</span>{mode === 'move' ? t('Sposta elimina la sorgente solo dopo il trasferimento riuscito.') : t('Copia non modifica i file presenti nella sorgente; un file omonimo in destinazione può essere sovrascritto.')} {t('Usa il pulsante in ogni riga anche senza drag-and-drop.')}</p>
    </section>
  </LocalizeTree>);
}

function FilePane({ index, pane, remotes, mode, busy, isDropTarget, onRemoteChange, onNavigate, onTransfer, onDrop, onDragEnter, onDragLeave, onRefresh, onAddRemote }) {
  const { t } = useTranslation('ui');
  const [sort, setSort] = useState({ key: 'name', direction: 'asc' });
  const target = pane.remote ? remotes.find((remote) => remote.name !== pane.remote)?.name : '';
  const segments = pane.path ? pane.path.split('/') : [];
  const handleDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = mode === 'copy' ? 'copy' : 'move';
    onDragEnter(index);
  };
  const sortedEntries = [...pane.entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    const comparison = sort.key === 'size'
      ? Number(a.size || 0) - Number(b.size || 0)
      : sort.key === 'modified'
        ? (Date.parse(a.mod_time) || 0) - (Date.parse(b.mod_time) || 0)
        : a.name.localeCompare(b.name, 'it', { numeric: true, sensitivity: 'base' });
    return sort.direction === 'asc' ? comparison : -comparison;
  });
  const sortHeader = (key, label, className = '') => {
    const active = sort.key === key;
    const SortIcon = sort.direction === 'asc' ? ChevronUp : ChevronDown;
    return <th scope="col" className={className} aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className="sort-button" onClick={() => setSort((current) => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }))}>
        {label}{active ? <SortIcon size={13} aria-hidden="true" /> : <span className="sort-icon-placeholder" />}
      </button>
    </th>;
  };

  return (<LocalizeTree>
    <section
      className={`file-pane ${isDropTarget ? 'drop-active' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onDragLeave(); }}
      onDrop={(event) => onDrop(event, index)}
      aria-label={t('Panel {{side}}', { side: t(index === 0 ? 'Source' : 'Destination') })}
    >
      <header className="pane-header">
        <div className="pane-title-line"><span className={`pane-role ${index === 0 ? 'source' : 'destination'}`}>{index === 0 ? 'Sorgente' : 'Destinazione'}</span>
          <button className="icon-button small" onClick={() => onRefresh(index)} aria-label={`Aggiorna ${pane.remote || 'remote'}`} title="Aggiorna elenco"><RefreshCw size={15} /></button>
        </div>
        <label className="remote-picker"><HardDrive size={17} /><span className="sr-only">Remote {index === 0 ? 'sorgente' : 'destinazione'}</span>
          <select value={pane.remote} onChange={(event) => onRemoteChange(index, event.target.value)}>
            <option value="">Seleziona un remote</option>
            {remotes.map((remote) => <option data-user-content key={remote.name} value={remote.name}>{remote.name}{remote.test ? ' · test' : ''}</option>)}
          </select>
        </label>
        <nav className="path-crumbs" aria-label="Percorso remoto">
          <button onClick={() => onNavigate(index, pane.remote, '')} aria-label="Radice"><Home size={14} /><span data-user-content>{pane.remote || 'Root'}</span></button>
          {segments.map((segment, segmentIndex) => (
            <React.Fragment key={`${segment}-${segmentIndex}`}>
              <ChevronRight size={13} aria-hidden="true" />
              <button data-user-content onClick={() => onNavigate(index, pane.remote, segments.slice(0, segmentIndex + 1).join('/'))}>{segment}</button>
            </React.Fragment>
          ))}
        </nav>
      </header>

      <div className="table-scroll">
        <table className="file-table">
          <thead><tr>{sortHeader('name', 'Nome')}{sortHeader('size', 'Dimensione', 'size-column')}<th scope="col" className="type-column">Tipo</th>{sortHeader('modified', 'Modificato', 'date-column')}<th scope="col" className="action-column"><span className="sr-only">Azione</span></th></tr></thead>
          <tbody>
            {pane.path && (
              <tr className="parent-row"><td colSpan="5"><button onClick={() => onNavigate(index, pane.remote, segments.slice(0, -1).join('/'))}><ArrowRight size={14} className="up-icon" />Cartella superiore</button></td></tr>
            )}
            {sortedEntries.map((entry) => (
              <tr
                key={entry.path}
                draggable={!busy && Boolean(pane.remote)}
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/json', JSON.stringify({ pane: index, entry, mode }));
                  event.dataTransfer.effectAllowed = mode === 'copy' ? 'copyMove' : 'move';
                }}
                className="file-row"
              >
                <td className="name-cell">
                  <button className="file-name-button" onDoubleClick={() => entry.is_dir && onNavigate(index, pane.remote, entry.path)} onClick={() => entry.is_dir && onNavigate(index, pane.remote, entry.path)} title={entry.is_dir ? t('Open {{name}}', { name: entry.name }) : entry.name}>
                    {entry.is_dir ? <Folder size={17} className="folder-icon" /> : <File size={17} className="file-icon" />}
                    <span data-user-content>{entry.name}</span>
                  </button>
                </td>
                <td className="size-column">{entry.is_dir ? '—' : formatSize(entry.size)}</td>
                <td className="type-column">{entry.is_dir ? 'Cartella' : 'File'}</td>
                <td className="date-column">{formatDate(entry.mod_time)}</td>
                <td className="action-column"><button
                  className="row-action"
                  disabled={busy || !target}
                  onClick={() => onTransfer(index, entry, 1 - index)}
                  aria-label={t(mode === 'copy' ? 'Copy {{name}} to {{destination}}' : 'Move {{name}} to {{destination}}', { name: entry.name, destination: target || t('the other panel') })}
                  title={t(mode === 'copy' ? 'Copy to {{destination}}' : 'Move to {{destination}}', { destination: target || t('the other remote') })}
                >{mode === 'copy' ? <Copy size={15} /> : <ArrowRight size={15} />}<span>{mode === 'copy' ? 'Copia' : 'Sposta'}</span></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {pane.remote && pane.entries.length === 0 && !pane.path && (
          <div className="empty-state"><Folder size={26} /><strong>Questo remote è vuoto</strong><span>Trascina qui file dall’altro pannello oppure usa un’azione per riga.</span></div>
        )}
        {pane.remote && pane.entries.length === 0 && pane.path && (
          <div className="empty-state"><Folder size={25} /><strong>Cartella vuota</strong><span>Prova a tornare alla radice o scegli un altro percorso.</span></div>
        )}
        {!pane.remote && (
          <div className="empty-state"><HardDrive size={26} /><strong>Nessun remote selezionato</strong><span>Scegli un remote per esplorarne i file.</span>{!remotes.length && <button className="text-button" onClick={onAddRemote}><Plus size={15} /> Aggiungi il primo remote</button>}</div>
        )}
      </div>
      <footer className="pane-footer"><span>{pane.remote ? t('item_count', { count: pane.entries.length }) : 'Seleziona un remote'}</span><span>{t(index === 0 ? '01 / Sorgente' : '02 / Destinazione')}</span></footer>
    </section>
  </LocalizeTree>);
}

function jobErrorSummary(value) {
  if (value.includes('input member Key must not be empty')) return 'Destinazione S3 senza bucket. Scegli un bucket o una cartella sorgente con nome.';
  const line = value.split(/\r?\n/).find((item) => /Failed to (?:copy|transfer|upload):/i.test(item)) || value.split(/\r?\n/).find(Boolean) || 'Il job non è riuscito.';
  const message = line.replace(/^\d{4}\/\d{2}\/\d{2}\s+\S+\s+(?:ERROR|NOTICE)\s*:\s*/i, '').replace(/^.*?Failed to (?:copy|transfer|upload):\s*/i, '').trim();
  return message.length > 180 ? `${message.slice(0, 177)}…` : message;
}

function JobsWorkspace({ jobs, remotes, busy, onCreate, onEdit, onDelete, onRun }) {
  const { t } = useTranslation('ui');
  const [errorJob, setErrorJob] = useState(null);
  return (<LocalizeTree>
    <section className="workspace-view" aria-labelledby="jobs-title">
      <div className="page-heading"><div><h1 id="jobs-title">Job di sincronizzazione</h1><p>Salva una configurazione di trasferimento e avviala quando serve.</p></div><button className="primary-button" onClick={onCreate} disabled={remotes.length < 2}><Plus size={16} />Nuovo job</button></div>
      {jobs.length ? (
        <div className="jobs-table-wrap">
          <table className="jobs-table">
            <thead><tr><th scope="col">Nome</th><th scope="col">Operazione</th><th scope="col">Percorso</th><th scope="col">Ultimo esito</th><th scope="col">Programmazione</th><th scope="col"><span className="sr-only">Azioni</span></th></tr></thead>
            <tbody>{jobs.map((job) => (
              <tr key={job.id}>
                <td><strong data-user-content>{job.name}</strong><span className="job-sub">{job.last_run ? t('Last run: {{date}}', { date: formatDate(job.last_run) }) : 'Non ancora eseguito'}</span></td>
                <td><span className={`job-mode ${job.mode}`}>{job.mode === 'sync' ? 'Sincronizza' : 'Copia'}</span></td>
                <td><span className="job-route" data-user-content>{job.source_remote}:{job.source_path || '/'}<ArrowRight size={14} />{job.destination_remote}:{job.destination_path || '/'}</span></td>
                <td><span className={`job-status ${job.status}`}><span className="status-dot" />{job.status === 'success' ? 'Completato' : job.status === 'failed' ? 'Errore' : job.status === 'running' ? 'In esecuzione' : 'Pronto'}</span>{job.status === 'failed' && job.last_result && <div className="job-error-summary"><span>{jobErrorSummary(job.last_result)}</span><button type="button" className="job-error-details-button" onClick={() => setErrorJob(job)}>Dettagli errore</button></div>}</td>
                <td>{job.schedule_enabled ? <span className="schedule-summary"><code data-user-content>{job.cron}</code><small>{t('Next: {{date}} · server time', { date: formatScheduledTime(job.next_run) })}</small></span> : <span className="job-sub">Manuale</span>}</td>
                <td><div className="job-actions"><button className="run-button" disabled={busy || job.status === 'running'} onClick={() => onRun(job)}><Play size={14} fill="currentColor" />Esegui</button><button className="icon-button small" disabled={job.status === 'running'} onClick={() => onEdit(job)} aria-label={t('Edit {{name}}', { name: job.name })} title="Modifica job"><Pencil size={15} /></button><button className="icon-button small job-delete-button" disabled={job.status === 'running'} onClick={() => onDelete(job)} aria-label={t('Delete {{name}}', { name: job.name })} title="Elimina job"><Trash2 size={15} /></button></div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="empty-jobs"><div className="empty-line"><Clock3 size={19} /><span>Nessun job salvato</span></div><p>Crea un job di copia o sincronizzazione tra due remote. La sincronizzazione può eliminare file presenti solo nella destinazione.</p><button className="primary-button" onClick={onCreate} disabled={remotes.length < 2}><Plus size={16} />Crea il primo job</button>{remotes.length < 2 && <span className="inline-note">Configura almeno due remote per creare un job.</span>}</div>
      )}
      {errorJob && <JobErrorDetails job={errorJob} onClose={() => setErrorJob(null)} />}
    </section>
  </LocalizeTree>);
}

function JobErrorDetails({ job, onClose }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const copyErrorDetails = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Copia appunti non disponibile in questo browser.');
      await navigator.clipboard.writeText(job.last_result || '');
      setCopied(true);
      setCopyError('');
    } catch (error) {
      setCopyError(error.message);
    }
  };
  return (<LocalizeTree>
    <ModalBackdrop onClose={onClose}>
      <section className="dialog job-error-dialog" role="dialog" aria-modal="true" aria-labelledby="job-error-title">
        <div className="dialog-heading"><div><h2 id="job-error-title">Dettagli errore</h2><p>Job: <strong data-user-content>{job.name}</strong></p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Chiudi dettagli errore"><X size={17} /></button></div>
        <div className="job-error-callout"><TriangleAlert size={17} /><span>{jobErrorSummary(job.last_result || '')}</span></div>
        <pre className="job-error-log"><code>{job.last_result || 'Il job è fallito senza un messaggio di dettaglio.'}</code></pre>
        <div className="job-error-footer"><span aria-live="polite">{copyError || (copied ? 'Log copiato negli appunti.' : 'Il log completo è disponibile qui sopra.')}</span><div className="dialog-actions"><button type="button" className="secondary-button" onClick={copyErrorDetails}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copiato' : 'Copia log'}</button><button type="button" className="primary-button" onClick={onClose}>Chiudi</button></div></div>
      </section>
    </ModalBackdrop>
  </LocalizeTree>);
}

function SettingsWorkspace({ remotes, onAdd, onEdit, flash, setError, refresh, language, onLanguageChange }) {
  const { t } = useTranslation('ui');
  const [config, setConfig] = useState('');
  const [saving, setSaving] = useState(false);
  const [configVisible, setConfigVisible] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [configLoadError, setConfigLoadError] = useState('');
  const [configLoadAttempt, setConfigLoadAttempt] = useState(0);

  useEffect(() => {
    if (!configVisible || configLoaded) return undefined;
    let current = true;
    setConfigLoading(true);
    setConfigLoadError('');
    api('/config')
      .then((result) => { if (current) { setConfig(result.content); setConfigLoaded(true); } })
      .catch((requestError) => { if (current) setConfigLoadError(requestError.message); })
      .finally(() => { if (current) setConfigLoading(false); });
    return () => { current = false; };
  }, [configVisible, configLoaded, configLoadAttempt]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const result = await api('/config', { method: 'PUT', body: JSON.stringify({ content: config }) });
      const savedConfig = await api('/config');
      setConfig(savedConfig.content);
      await refresh();
      flash(t('configuration_saved', { count: result.remotes }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const exportConfig = () => {
    const url = URL.createObjectURL(new Blob([config], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'rclone.conf';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (<LocalizeTree>
    <section className="workspace-view" aria-labelledby="settings-title">
      <div className="page-heading"><div><h1 id="settings-title">Configurazione</h1><p>Gestisci i remote e il file standard di rclone.</p></div><button className="primary-button" onClick={onAdd}><Plus size={16} />Nuovo remote</button></div>
      <section className="settings-section language-section" aria-labelledby="language-title">
        <div className="section-heading"><div><h2 id="language-title">Lingua</h2><p>Scegli la lingua dell’interfaccia.</p></div></div>
        <label className="form-field language-picker"><span>Lingua</span><select value={language.startsWith('it') ? 'it' : 'en'} onChange={(event) => onLanguageChange(event.target.value)}><option value="en">English</option><option value="it">Italiano</option></select></label>
      </section>
      <section className="settings-section" aria-labelledby="remote-list-title">
        <div className="section-heading"><div><h2 id="remote-list-title">Remote configurati</h2><p>Le credenziali restano nel file privato di rclone.</p></div><span className="section-count">{t('remote_count', { count: remotes.length })}</span></div>
        {remotes.length ? <div className="remote-table-wrap"><table className="remote-table"><thead><tr><th scope="col">Remote</th><th scope="col">Backend</th><th scope="col">Stato</th><th scope="col"><span className="sr-only">Modifica</span></th></tr></thead><tbody>{remotes.map((remote) => (
          <tr key={remote.name}><td><span className="remote-name"><HardDrive size={16} /><span data-user-content>{remote.name}</span></span></td><td><span data-user-content>{remote.type}</span>{remote.test && <span className="test-badge">Remote di test</span>}</td><td><span className="job-status success"><span className="status-dot" />Configurato</span></td><td><button className="secondary-button compact" onClick={() => onEdit(remote)}>Modifica</button></td></tr>
        ))}</tbody></table></div> : <div className="empty-remote"><HardDrive size={24} /><strong>Nessun remote</strong><span>Crea un remote con il wizard o importa un file rclone.conf.</span></div>}
      </section>

      <section className="settings-section config-section" aria-labelledby="config-title">
        <div className="section-heading"><div><h2 id="config-title">File rclone.conf</h2><p>La configurazione raw resta nascosta finché non scegli di mostrarla.</p></div><div className="config-heading-actions">{configVisible && configLoaded && <button className="secondary-button" onClick={exportConfig}><ArrowDownToLine size={15} />Esporta</button>}<button type="button" className="icon-button config-visibility-button" aria-label={configVisible ? 'Nascondi configurazione raw' : 'Mostra configurazione raw'} aria-expanded={configVisible} aria-controls="rclone-config-panel" title={configVisible ? 'Nascondi configurazione' : 'Mostra configurazione'} onClick={() => setConfigVisible((visible) => !visible)}>{configVisible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div>
        {!configVisible && <div className="config-hidden-state"><Eye size={17} /><div><strong>Configurazione nascosta</strong><span>Può contenere token e password. Usa l’icona dell’occhio per mostrarla.</span></div></div>}
        <div id="rclone-config-panel" hidden={!configVisible}>
          {configVisible && <>
            {configLoading && <div className="config-load-state" role="status"><LoaderCircle size={16} className="spin" />Caricamento della configurazione…</div>}
            {configLoadError && <div className="alert alert-error config-load-error" role="alert"><TriangleAlert size={16} /><span>Impossibile caricare il file rclone.conf: {configLoadError}</span><button type="button" className="secondary-button" onClick={() => setConfigLoadAttempt((attempt) => attempt + 1)}>Riprova</button></div>}
            {configLoaded && <><label className="sr-only" htmlFor="rclone-config">Configurazione rclone</label><textarea id="rclone-config" className="config-editor" spellCheck="false" value={config} onChange={(event) => setConfig(event.target.value)} placeholder={'[mio-remote]\ntype = drive'} /><div className="config-actions"><span>Il file può contenere token e password. Trattalo come un segreto.</span><button className="primary-button" disabled={saving} onClick={saveConfig}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}Salva configurazione</button></div></>}
          </>}
        </div>
      </section>
    </section>
  </LocalizeTree>);
}

function RemoteWorkspace({ providers, remote, onCancel, onSubmit }) {
  const { t } = useTranslation('ui');
  const [name, setName] = useState(remote?.name || '');
  const [type, setType] = useState(remote?.type || 'local');
  const [providerSearch, setProviderSearch] = useState('');
  const [showAllProviders, setShowAllProviders] = useState(false);
  const [testRoot, setTestRoot] = useState(remote?.test ?? true);
  const [options, setOptions] = useState({});
  const [saving, setSaving] = useState(false);
  const providerRows = [...providers];
  if (!providerRows.some((provider) => (provider.Name || provider.name) === 'local')) {
    providerRows.push({ Name: 'local', Description: 'Filesystem locale' });
  }
  const sortedProviders = providerRows.sort((a, b) => (a.Name || a.name).localeCompare(b.Name || b.name, 'it', { sensitivity: 'base' }));
  const filteredProviders = sortedProviders.filter((provider) => {
    const searchable = `${provider.Name || provider.name} ${provider.Description || ''}`.toLocaleLowerCase('it');
    return searchable.includes(providerSearch.trim().toLocaleLowerCase('it'));
  });
  const selected = sortedProviders.find((provider) => (provider.Name || provider.name) === type);
  const showingProviderResults = !remote && (showAllProviders || providerSearch.trim().length > 0);
  const optionList = selected?.Options || selected?.options || [];
  const visibleOptions = optionList.filter((option) => (option.Name || option.name) !== 'type' && !option.Hide);
  const primaryOptions = visibleOptions.filter((option) => !option.Advanced || option.Required);
  const advancedOptions = visibleOptions.filter((option) => option.Advanced && !option.Required);
  const renderOption = (option) => {
    const key = option.Name || option.name;
    const label = key.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
    const examples = Array.isArray(option.Examples) ? option.Examples.filter((example) => example.Value !== undefined && String(example.Value) !== '') : [];
    const isChoice = examples.length > 1 && /\b(?:choose|select)\b/i.test(option.Help || '');
    const defaultValue = remote || option.Default == null ? '' : String(option.Default);
    const choicesIncludeDefault = examples.some((example) => String(example.Value) === defaultValue);
    return (
      <div className="form-field" key={key}>
        <label htmlFor={`option-${key}`}>{label}</label>
        {option.Help && <span>{option.Help}</span>}
        {option.Type === 'bool' ? (
          <label className="boolean-option"><input id={`option-${key}`} type="checkbox" checked={options[key] !== undefined ? options[key] === 'true' : Boolean(option.Default)} onChange={(event) => setOptions((current) => ({ ...current, [key]: String(event.target.checked) }))} />Attivo</label>
        ) : isChoice ? (
          <select id={`option-${key}`} required={!remote && Boolean(option.Required)} value={options[key] ?? (choicesIncludeDefault ? defaultValue : '')} onChange={(event) => setOptions((current) => ({ ...current, [key]: event.target.value }))}>
            <option value="">{remote ? 'Vuoto = mantieni il valore corrente' : 'Seleziona un’opzione'}</option>
            {examples.map((example) => <option key={example.Value} value={String(example.Value)}>{example.Value}{example.Help ? ` — ${example.Help}` : ''}</option>)}
          </select>
        ) : (
          <input id={`option-${key}`} type={option.IsPassword || /pass|secret|token/i.test(key) ? 'password' : 'text'} required={!remote && Boolean(option.Required)} value={options[key] || ''} onChange={(event) => setOptions((current) => ({ ...current, [key]: event.target.value }))} placeholder={remote ? 'Vuoto = mantieni valore corrente' : option.Default !== undefined ? String(option.Default) : ''} />
        )}
      </div>
    );
  };

  const submit = async (event) => {
    event.preventDefault();
    if (showingProviderResults) return;
    setSaving(true);
    await onSubmit({ name, type, test_root: testRoot, options: Object.fromEntries(Object.entries(options).filter(([, value]) => value !== '')) });
    setSaving(false);
  };

  return (<LocalizeTree>
    <section className="workspace-view remote-workspace" aria-labelledby="remote-editor-title">
      <div className="page-heading remote-page-heading">
        <div>
          <h1 id="remote-editor-title">{remote ? 'Modifica remote' : 'Aggiungi remote'}</h1>
          <p>{remote ? 'Aggiorna la configurazione della connessione.' : 'Scegli un provider e configura la connessione a file e archivi.'}</p>
        </div>
        <button type="button" className="secondary-button" onClick={onCancel}><ArrowLeft size={16} />Indietro</button>
      </div>
      <form className="remote-form-shell" onSubmit={submit}>
        <div className="remote-form-intro"><h2>Dettagli della connessione</h2><p>Il nome identifica questo remote nei trasferimenti e nelle configurazioni.</p></div>
        <div className="form-field"><label htmlFor="remote-name">Nome remote</label><input id="remote-name" required disabled={Boolean(remote)} value={name} onChange={(event) => setName(event.target.value)} pattern={"[A-Za-z0-9_][A-Za-z0-9_.\\-]{0,63}"} placeholder="es. archivio" /><span>Lettere, numeri, punto, trattino e underscore.</span></div>
        <div className="provider-picker">
          <div className="provider-picker-heading">
            <div><h3 id="provider-picker-title">Provider</h3><p>Scegli il servizio da collegare al remote.</p></div>
            <span>{t('provider_count', { count: sortedProviders.length })}</span>
          </div>
          <label className="provider-search-label" htmlFor="provider-search">Cerca tra i provider</label>
          <div className="provider-search-input"><Search size={17} aria-hidden="true" /><input id="provider-search" type="search" disabled={Boolean(remote)} value={providerSearch} onChange={(event) => { setProviderSearch(event.target.value); setShowAllProviders(false); }} placeholder="Nome o descrizione, per esempio S3" /></div>
          <span className="provider-search-status" aria-live="polite">{remote ? t('Configured provider cannot be changed.') : providerSearch.trim() ? filteredProviders.length ? t('result_count', { count: filteredProviders.length }) : 'Nessun provider trovato.' : 'Cerca per nome o descrizione.'}</span>
          {showingProviderResults ? (
            <>
              <div className="provider-results-heading"><strong>{providerSearch.trim() ? 'Risultati' : 'Tutti i provider'}</strong><span>{filteredProviders.length}</span></div>
              <div className="provider-results" aria-label="Risultati provider">
                {filteredProviders.length ? filteredProviders.map((provider) => {
                  const providerName = provider.Name || provider.name;
                  const isSelected = providerName === type;
                  return <button key={providerName} type="button" className={`provider-result ${isSelected ? 'is-selected' : ''}`} aria-pressed={isSelected} onClick={() => { setType(providerName); setProviderSearch(''); setShowAllProviders(false); setTestRoot(providerName === 'local'); setOptions({}); }}>
                    <span className="provider-result-copy"><strong className="provider-result-name" data-user-content>{providerName}</strong>{provider.Description && <span className="provider-result-description" data-user-content>{provider.Description}</span>}</span>
                    {isSelected && <Check size={16} aria-hidden="true" />}
                  </button>;
                }) : <div className="provider-results-empty"><span>Nessun provider corrisponde alla ricerca.</span><button type="button" className="text-button" onClick={() => { setProviderSearch(''); setShowAllProviders(false); }}>Cancella ricerca</button></div>}
              </div>
            </>
          ) : (
            <div className="provider-current" role="status">
              <span className="provider-current-icon"><HardDrive size={17} /></span>
              <span className="provider-current-copy"><small>Provider selezionato</small><strong data-user-content>{selected?.Name || type}</strong>{selected?.Description && <span data-user-content>{selected.Description}</span>}</span>
              {remote ? <span className="provider-current-status"><Check size={15} />Configurato</span> : <button type="button" className="secondary-button compact" onClick={() => setShowAllProviders(true)}><Search size={14} />Cambia</button>}
            </div>
          )}
        </div>
        {showingProviderResults ? (
          <p className="provider-selection-hint" role="status">{t('Current provider: {{name}}. Select a result to configure the connection.', { name: selected?.Name || type })}</p>
        ) : (
          <>
            {type === 'local' && <label className="test-root-check"><input type="checkbox" checked={testRoot} onChange={(event) => setTestRoot(event.target.checked)} /><span><strong>Remote locale confinato</strong><small>Limita i file di test alla cartella dati dell’app.</small></span></label>}
            {primaryOptions.length > 0 && (
              <>
                <div className="provider-section-heading"><h3>Configurazione principale</h3><span>{primaryOptions.length} campi</span></div>
                <div className="provider-fields">{primaryOptions.map(renderOption)}</div>
              </>
            )}
            {advancedOptions.length > 0 && (
              <details className="advanced-options">
                <summary>
                  <span className="advanced-summary-copy"><strong>Opzioni avanzate</strong><span>Parametri facoltativi di rclone</span></span>
                  <span className="advanced-summary-meta">{advancedOptions.length} campi<ChevronDown size={16} /></span>
                </summary>
                <div className="provider-fields">{advancedOptions.map(renderOption)}</div>
              </details>
            )}
          </>
        )}
        <div className="remote-form-actions"><button type="button" className="secondary-button" onClick={onCancel}>Annulla</button><button className="primary-button" disabled={saving || showingProviderResults}>{saving && <LoaderCircle size={16} className="spin" />}{remote ? 'Salva modifiche' : 'Salva remote'}</button></div>
      </form>
    </section>
  </LocalizeTree>);
}

function FolderPicker({ remote, initialPath, onCancel, onSelect }) {
  const { t } = useTranslation('ui');
  const [path, setPath] = useState(initialPath || '');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    api(`/browse/${encodeURIComponent(remote)}?path=${encodeURIComponent(path)}`)
      .then((result) => { if (current) setEntries(result.entries.filter((entry) => entry.is_dir)); })
      .catch((reason) => { if (current) setError(reason.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [remote, path]);

  const parts = path ? path.split('/').filter(Boolean) : [];
  const openPath = (nextPath) => setPath(nextPath.replace(/^\/+|\/+$/g, ''));
  return (<LocalizeTree>
    <ModalBackdrop onClose={onCancel}>
      <section className="dialog folder-picker" role="dialog" aria-modal="true" aria-labelledby="folder-picker-title">
        <div className="dialog-heading"><div><h2 id="folder-picker-title">Scegli una cartella</h2><p>{t('folder_picker_intro', { remote })}</p></div><button type="button" className="icon-button" onClick={onCancel} aria-label="Chiudi"><X size={17} /></button></div>
        <nav className="folder-picker-breadcrumbs" aria-label="Percorso cartelle"><button type="button" onClick={() => openPath('')}>{t('remote_root', { remote })}</button>{parts.map((part, index) => <React.Fragment key={`${part}-${index}`}><ChevronRight size={13} /><button data-user-content type="button" onClick={() => openPath(parts.slice(0, index + 1).join('/'))}>{part}</button></React.Fragment>)}</nav>
        <div className="folder-picker-list" aria-live="polite">
          {path && <button type="button" className="folder-picker-entry folder-picker-parent" onClick={() => openPath(parts.slice(0, -1).join('/'))}><ArrowLeft size={15} /><span>Cartella superiore</span></button>}
          {loading ? <div className="folder-picker-state"><LoaderCircle size={16} className="spin" />Caricamento cartelle…</div>
            : error ? <div className="folder-picker-state folder-picker-error"><TriangleAlert size={16} />{error}</div>
              : entries.length ? entries.map((entry) => <button type="button" className="folder-picker-entry" key={entry.path} onClick={() => openPath(entry.path)}><Folder size={16} /><span data-user-content>{entry.name}</span><ChevronRight size={15} /></button>)
                : <div className="folder-picker-state">Nessuna sottocartella in questo percorso.</div>}
        </div>
        <div className="folder-picker-selection"><span>Cartella selezionata</span><strong>{path ? <span data-user-content>{path}</span> : 'Radice del remote'}</strong></div>
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onCancel}>Annulla</button><button type="button" className="primary-button" onClick={() => onSelect(path)}>Usa questa cartella</button></div>
      </section>
    </ModalBackdrop>
  </LocalizeTree>);
}

function JobWorkspace({ remotes, job, onCancel, onSubmit }) {
  const presets = { hourly: '0 * * * *', daily: '0 2 * * *', weekly: '0 2 * * 1', monthly: '0 2 1 * *' };
  const initialCron = job?.cron || '0 2 * * *';
  const initialPreset = Object.keys(presets).find((key) => presets[key] === initialCron) || 'custom';
  const [name, setName] = useState(job?.name || '');
  const [sourceRemote, setSourceRemote] = useState(job?.source_remote || remotes[0]?.name || '');
  const [destinationRemote, setDestinationRemote] = useState(job?.destination_remote || remotes.find((remote) => remote.name !== (job?.source_remote || remotes[0]?.name))?.name || '');
  const [sourcePath, setSourcePath] = useState(job?.source_path || '');
  const [destinationPath, setDestinationPath] = useState(job?.destination_path || '');
  const [mode, setMode] = useState(job?.mode || 'copy');
  const [scheduleEnabled, setScheduleEnabled] = useState(Boolean(job?.schedule_enabled));
  const [cron, setCron] = useState(initialCron);
  const [cronPreset, setCronPreset] = useState(initialPreset);
  const [scheduleSyncConfirmed, setScheduleSyncConfirmed] = useState(Boolean(job?.schedule_sync_confirmed));
  const [saving, setSaving] = useState(false);
  const [folderPicker, setFolderPicker] = useState(null);
  const [cronPreview, setCronPreview] = useState({ loading: false, nextRun: null, error: '' });
  const sourceFolderParts = sourcePath.split('/').filter(Boolean);
  const sourceFolderName = sourceFolderParts[sourceFolderParts.length - 1] || '';
  const destinationRemoteType = remotes.find((remote) => remote.name === destinationRemote)?.type?.toLowerCase() || '';
  const destinationIsS3Root = destinationRemoteType === 's3' && !destinationPath;
  const effectiveDestinationPath = destinationIsS3Root ? sourceFolderName : destinationPath;

  useEffect(() => {
    if (!scheduleEnabled) {
      setCronPreview({ loading: false, nextRun: null, error: '' });
      return undefined;
    }
    let current = true;
    let request = null;
    const refresh = async () => {
      if (request) request.abort();
      request = new AbortController();
      setCronPreview((previous) => ({ ...previous, loading: true, error: '' }));
      try {
        const response = await fetch(`/api/cron/preview?expression=${encodeURIComponent(cron)}`, { signal: request.signal });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.detail || response.statusText);
        if (current) setCronPreview({ loading: false, nextRun: result.next_run, error: '' });
      } catch (reason) {
        if (current && reason.name !== 'AbortError') setCronPreview({ loading: false, nextRun: null, error: reason.message });
      }
    };
    const debounce = setTimeout(refresh, 350);
    const interval = setInterval(refresh, 60_000);
    return () => { current = false; clearTimeout(debounce); clearInterval(interval); request?.abort(); };
  }, [scheduleEnabled, cron]);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ ...(job ? { id: job.id } : {}), name, source_remote: sourceRemote, source_path: sourcePath, destination_remote: destinationRemote, destination_path: effectiveDestinationPath, mode, schedule_enabled: scheduleEnabled, cron: scheduleEnabled ? cron : null, schedule_sync_confirmed: scheduleSyncConfirmed });
    } finally {
      setSaving(false);
    }
  };

  return (<LocalizeTree>
    <section className="workspace-view job-editor-workspace" aria-labelledby="job-editor-title">
      <div className="page-heading job-editor-heading">
        <div><h1 id="job-editor-title">{job ? 'Modifica job' : 'Nuovo job'}</h1><p>Definisci cosa eseguire, tra quali remote e quando avviarlo.</p></div>
        <button type="button" className="secondary-button" onClick={onCancel}><ArrowLeft size={15} />Torna ai job</button>
      </div>
      <form className="job-editor-form" onSubmit={submit}>
        <section className="job-editor-section" aria-labelledby="job-details-title">
          <div className="job-section-heading"><h2 id="job-details-title">Dettagli</h2><p>Identifica il job e scegli l’operazione da eseguire.</p></div>
          <div className="job-details-grid">
            <div className="form-field"><label htmlFor="job-name">Nome job</label><input id="job-name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="es. Backup documenti" /></div>
            <div className="form-field"><label htmlFor="job-mode">Operazione</label><select id="job-mode" value={mode} onChange={(event) => setMode(event.target.value)}><option value="copy">Copia</option><option value="sync">Sincronizza</option></select><div className={`job-mode-explainer ${mode === 'sync' ? 'is-warning' : ''}`}>{mode === 'copy' ? <><Copy size={16} /><span><strong>Copia gli elementi dalla sorgente.</strong> Non elimina file dalla destinazione e lascia intatta la sorgente.</span></> : <><TriangleAlert size={16} /><span><strong>Rende la destinazione uguale alla sorgente.</strong> I file presenti solo nella destinazione possono essere eliminati.</span></>}</div></div>
          </div>
        </section>
        <section className="job-editor-section" aria-labelledby="job-route-title">
          <div className="job-section-heading"><h2 id="job-route-title">Percorso</h2><p>Seleziona i remote e le cartelle di origine e destinazione.</p></div>
          <div className="job-route-grid">
            <div className="job-route-side"><span className="job-route-label">Origine</span><div className="form-field"><label htmlFor="job-source">Remote sorgente</label><select id="job-source" value={sourceRemote} onChange={(event) => { setSourceRemote(event.target.value); setSourcePath(''); }} required>{remotes.map((remote) => <option data-user-content key={remote.name} value={remote.name}>{remote.name}</option>)}</select></div><div className="form-field"><label htmlFor="job-source-path">Cartella sorgente</label><div className="folder-path-control"><input id="job-source-path" value={sourcePath || 'Radice del remote'} readOnly aria-label={`Cartella sorgente: ${sourcePath || 'radice del remote'}`} /><button type="button" className="secondary-button" onClick={() => setFolderPicker({ side: 'source', remote: sourceRemote, path: sourcePath })} disabled={!sourceRemote}><Folder size={14} />Sfoglia</button></div></div></div>
            <div className="job-route-connector" aria-hidden="true"><ArrowRight size={20} /></div>
            <div className="job-route-side destination"><span className="job-route-label">Destinazione</span><div className="form-field"><label htmlFor="job-destination">Remote destinazione</label><select id="job-destination" value={destinationRemote} onChange={(event) => { setDestinationRemote(event.target.value); setDestinationPath(''); }} required>{remotes.map((remote) => <option data-user-content key={remote.name} value={remote.name}>{remote.name}</option>)}</select></div><div className="form-field"><label htmlFor="job-destination-path">Cartella destinazione</label><div className="folder-path-control"><input id="job-destination-path" value={destinationPath || 'Radice del remote'} readOnly aria-label={`Cartella destinazione: ${destinationPath || 'radice del remote'}`} /><button type="button" className="secondary-button" onClick={() => setFolderPicker({ side: 'destination', remote: destinationRemote, path: destinationPath })} disabled={!destinationRemote}><Folder size={14} />Sfoglia</button></div>{destinationIsS3Root && (sourceFolderName ? <span className="folder-path-hint">Bucket di destinazione: <strong>{sourceFolderName}</strong>. Rclone lo creerà se non esiste e se il remote consente la creazione.</span> : <span className="folder-path-hint is-warning">Seleziona una cartella sorgente con nome oppure scegli un bucket esistente.</span>)}</div></div>
          </div>
        </section>
        <section className="job-editor-section" aria-labelledby="job-schedule-title">
          <div className="job-section-heading"><h2 id="job-schedule-title">Programmazione</h2><p>Avvia manualmente il job o imposta una ricorrenza cron.</p></div>
          <label className="schedule-toggle"><input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} /><span><strong>Programma questo job</strong><small>Il server lo avvierà automaticamente secondo la pianificazione.</small></span></label>
          {scheduleEnabled && <div className="schedule-editor">
            <div className="form-field"><label htmlFor="cron-preset">Frequenza</label><select id="cron-preset" value={cronPreset} onChange={(event) => { const value = event.target.value; setCronPreset(value); if (value !== 'custom') setCron(presets[value]); }}><option value="hourly">Ogni ora</option><option value="daily">Ogni giorno</option><option value="weekly">Ogni settimana</option><option value="monthly">Ogni mese</option><option value="custom">Personalizzata</option></select><span>Scegli una ricorrenza comune oppure definisci una regola cron.</span></div>
            <div className="form-field"><label htmlFor="cron-expression">Espressione cron</label><input id="cron-expression" value={cron} onChange={(event) => { setCron(event.target.value); setCronPreset('custom'); }} placeholder="minuto ora giorno mese settimana" required={scheduleEnabled} aria-describedby="cron-help cron-preview" /><span id="cron-help">5 campi: minuto · ora · giorno · mese · giorno della settimana. Fuso orario del server.</span></div>
            <div className={`cron-preview ${cronPreview.error ? 'has-error' : ''}`} id="cron-preview" aria-live="polite">{cronPreview.loading ? <><LoaderCircle size={15} className="spin" /><span>Calcolo della prossima esecuzione…</span></> : cronPreview.error ? <><TriangleAlert size={15} /><span>{cronPreview.error}</span></> : <><Clock3 size={15} /><span>Prossima esecuzione: <strong>{formatScheduledTime(cronPreview.nextRun)}</strong> <small>· ora del server</small></span></>}</div>
          </div>}
          {scheduleEnabled && mode === 'sync' && <label className="schedule-sync-confirm"><input type="checkbox" checked={scheduleSyncConfirmed} onChange={(event) => setScheduleSyncConfirmed(event.target.checked)} required /><span>Autorizzo i job automatici a eliminare dalla destinazione gli elementi assenti nella sorgente. Le esecuzioni manuali richiedono conferma ogni volta.</span></label>}
        </section>
        <footer className="job-editor-actions"><button type="button" className="secondary-button" onClick={onCancel}>Annulla</button><button className="primary-button" disabled={saving || remotes.length < 2 || (destinationIsS3Root && !sourceFolderName)}>{saving && <LoaderCircle size={16} className="spin" />}{job ? 'Salva modifiche' : 'Crea job'}</button></footer>
      </form>
      {folderPicker && <FolderPicker key={`${folderPicker.side}-${folderPicker.remote}`} remote={folderPicker.remote} initialPath={folderPicker.path} onCancel={() => setFolderPicker(null)} onSelect={(path) => { if (folderPicker.side === 'source') setSourcePath(path); else setDestinationPath(path); setFolderPicker(null); }} />}
    </section>
  </LocalizeTree>);
}

function DeleteJobConfirm({ job, onCancel, onConfirm }) {
  const { t } = useTranslation('ui');
  return <LocalizeTree><ModalBackdrop onClose={onCancel}><section className="dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-job-title" aria-describedby="delete-job-description"><div className="warning-mark"><Trash2 size={20} /></div><h2 id="delete-job-title">Eliminare questo job?</h2><p id="delete-job-description">{t('delete_job_confirmation', { name: job.name })}</p><div className="dialog-actions"><button className="secondary-button" onClick={onCancel}>Annulla</button><button className="danger-button" onClick={onConfirm}>Elimina job</button></div></section></ModalBackdrop></LocalizeTree>;
}

function DeleteFilesConfirm({ deletion, busy, onCancel, onContinue, onBack, onConfirm, remote }) {
  const { t } = useTranslation('ui');
  const folders = deletion.entries.filter((entry) => entry.is_dir);
  const count = deletion.entries.length;
  const names = deletion.entries.slice(0, 5);
  return (<LocalizeTree>
    <ModalBackdrop onClose={onCancel}>
      <section className="dialog confirm-dialog delete-files-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-files-title" aria-describedby="delete-files-description">
        <div className="warning-mark"><Trash2 size={20} /></div>
        {deletion.stage === 1 ? <>
          <h2 id="delete-files-title">Verifica gli elementi selezionati</h2>
          <p id="delete-files-description">{t('delete_files_review', { count, remote })}</p>
          <ul className="delete-files-list">{names.map((entry) => <li key={entry.path}><span data-user-content>{entry.name}</span><small>{entry.is_dir ? 'Cartella' : 'File'}</small></li>)}</ul>
          {count > names.length && <p className="delete-more-count">{t('and_more_items', { count: count - names.length })}</p>}
          {folders.length > 0 && <p className="delete-files-warning">{t('delete_folder_warning', { count: folders.length })}</p>}
          <div className="dialog-actions"><button className="secondary-button" onClick={onCancel}>Annulla</button><button className="primary-button" onClick={onContinue}>Continua</button></div>
        </> : <>
          <h2 id="delete-files-title">Conferma eliminazione definitiva</h2>
          <p id="delete-files-description">{t('delete_files_final', { count, remote })}</p>
          {folders.length > 0 && <p className="delete-files-warning">{t('delete_folder_final', { count: folders.length })}</p>}
          <div className="dialog-actions"><button className="secondary-button" onClick={onBack} disabled={busy}>Indietro</button><button className="danger-button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}Elimina definitivamente</button></div>
        </>}
      </section>
    </ModalBackdrop>
  </LocalizeTree>);
}

function SyncConfirm({ job, busy, onCancel, onConfirm }) {
  const { t } = useTranslation('ui');
  return (<LocalizeTree>
    <ModalBackdrop onClose={onCancel}>
      <section className="dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="sync-confirm-title" aria-describedby="sync-confirm-description">
        <div className="warning-mark"><TriangleAlert size={21} /></div>
        <h2 id="sync-confirm-title">Confermi la sincronizzazione?</h2>
        <p id="sync-confirm-description">{t('sync_confirmation', { name: job.name, remote: job.destination_remote })}</p>
        <div className="dialog-actions"><button className="secondary-button" onClick={onCancel} disabled={busy}>Annulla</button><button className="danger-button" onClick={onConfirm} disabled={busy}>{busy ? 'Sincronizzazione…' : 'Conferma ed esegui'}</button></div>
      </section>
    </ModalBackdrop>
  </LocalizeTree>);
}

createRoot(document.getElementById('root')).render(<App/>);
