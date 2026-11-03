import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  Check,
  ChevronRight,
  ChevronDown,
  Clock3,
  ChevronUp,
  Copy,
  File,
  Files,
  Folder,
  HardDrive,
  Home,
  LoaderCircle,
  Play,
  Plus,
  Search,
  RefreshCw,
  Settings2,
  TriangleAlert,
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
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium' }).format(date);
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

  return <div ref={backdrop} className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>{children}</div>;
}

function App() {
  const [remotes, setRemotes] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [providers, setProviders] = useState([]);
  const [health, setHealth] = useState(null);
  const [view, setView] = useState('browser');
  const [panes, setPanes] = useState([
    { remote: '', path: '', entries: [] },
    { remote: '', path: '', entries: [] },
  ]);
  const [transferMode, setTransferMode] = useState('move');
  const [modal, setModal] = useState('');
  const [editingRemote, setEditingRemote] = useState(null);
  const [remoteReturnView, setRemoteReturnView] = useState('settings');
  const [pendingSyncJob, setPendingSyncJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dropTarget, setDropTarget] = useState(-1);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState('');
  const noticeTimer = useRef(null);

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
      await api('/transfer', {
        method: 'POST',
        body: JSON.stringify({
          source_remote: source.remote,
          source_path: sourcePath,
          destination_remote: destination.remote,
          destination_path: destinationPath,
          mode,
        }),
      });
      flash(mode === 'copy' ? `${entry.name} copiato; l’originale è rimasto in ${source.remote}.` : `${entry.name} spostato in ${destination.remote}.`);
      await Promise.all([loadPane(sourceIndex), loadPane(destinationIndex)]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
      setDropTarget(-1);
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
      flash('Remote salvato.');
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const saveJob = async (job) => {
    try {
      await api('/jobs', { method: 'POST', body: JSON.stringify(job) });
      setModal('');
      await refresh();
      flash('Job creato.');
    } catch (requestError) {
      setError(requestError.message);
    }
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
      flash(result.status === 'success' ? `Job “${job.name}” completato.` : `Job non riuscito: ${result.last_result}`);
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#browser" onClick={(event) => { event.preventDefault(); setView('browser'); }}>
          <span className="brand-mark"><ArrowLeftRight size={19} strokeWidth={2.2} /></span>
          <span>Rclone<span className="brand-light"> Desk</span></span>
        </a>

        <nav className="primary-nav" aria-label="Navigazione principale">
          <p className="nav-label">Workspace</p>
          <button className={`nav-item ${view === 'browser' ? 'is-active' : ''}`} onClick={() => setView('browser')}>
            <Files size={17} /><span>Trasferimenti</span>
          </button>
          <button className={`nav-item ${view === 'jobs' ? 'is-active' : ''}`} onClick={() => setView('jobs')}>
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
            <button key={remote.name} className="remote-nav" onClick={() => {
              setView('browser');
              setPane(0, { remote: remote.name, path: '' });
              loadPane(0, remote.name, '');
            }}>
              <HardDrive size={15} /><span>{remote.name}</span>{remote.test && <span className="test-mark">TEST</span>}
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
          <div className="breadcrumbs-top"><span>Rclone Desk</span><ChevronRight size={14} /><span>{view === 'browser' ? 'Trasferimenti' : view === 'jobs' ? 'Job' : view === 'remote' ? (editingRemote ? 'Modifica remote' : 'Nuovo remote') : 'Configurazione'}</span></div>
          <div className="topbar-actions">
            {health && <span className="connected-label"><span className="status-dot is-online" />Connesso</span>}
            <button className="icon-button" aria-label="Aggiorna" title="Aggiorna" onClick={refresh}><RefreshCw size={16} /></button>
            {view !== 'remote' && <button className="top-add" onClick={openAddRemote}><Plus size={16} /><span>Nuovo remote</span></button>}
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

          {view === 'jobs' && (
            <JobsWorkspace jobs={jobs} remotes={remotes} busy={busy} onCreate={() => setModal('job')} onRun={runJob} />
          )}

          {view === 'settings' && (
            <SettingsWorkspace
              remotes={remotes}
              onAdd={openAddRemote}
              onEdit={openEditRemote}
              flash={flash}
              setError={setError}
              refresh={refresh}
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

      {modal === 'job' && (
        <JobModal remotes={remotes} onClose={() => setModal('')} onSubmit={saveJob} />
      )}
      {pendingSyncJob && (
        <SyncConfirm job={pendingSyncJob} busy={busy} onCancel={() => setPendingSyncJob(null)} onConfirm={() => runJob(pendingSyncJob, true)} />
      )}
    </div>
  );
}

function TransferWorkspace({ panes, remotes, mode, busy, dropTarget, onModeChange, onSwapPanes, onRemoteChange, onNavigate, onTransfer, onDrop, onDragEnter, onDragLeave, onRefresh, onAddRemote }) {
  return (
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
      <p className="transfer-help"><span className="help-symbol">i</span>{mode === 'move' ? 'Sposta elimina la sorgente solo dopo un trasferimento riuscito.' : 'Copia non modifica i file presenti nella sorgente; un file omonimo in destinazione può essere sovrascritto.'} Usa il pulsante in ogni riga anche senza drag-and-drop.</p>
    </section>
  );
}

function FilePane({ index, pane, remotes, mode, busy, isDropTarget, onRemoteChange, onNavigate, onTransfer, onDrop, onDragEnter, onDragLeave, onRefresh, onAddRemote }) {
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

  return (
    <section
      className={`file-pane ${isDropTarget ? 'drop-active' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onDragLeave(); }}
      onDrop={(event) => onDrop(event, index)}
      aria-label={`Pannello ${index === 0 ? 'sorgente' : 'destinazione'}`}
    >
      <header className="pane-header">
        <div className="pane-title-line"><span className={`pane-role ${index === 0 ? 'source' : 'destination'}`}>{index === 0 ? 'Sorgente' : 'Destinazione'}</span>
          <button className="icon-button small" onClick={() => onRefresh(index)} aria-label={`Aggiorna ${pane.remote || 'remote'}`} title="Aggiorna elenco"><RefreshCw size={15} /></button>
        </div>
        <label className="remote-picker"><HardDrive size={17} /><span className="sr-only">Remote {index === 0 ? 'sorgente' : 'destinazione'}</span>
          <select value={pane.remote} onChange={(event) => onRemoteChange(index, event.target.value)}>
            <option value="">Seleziona un remote</option>
            {remotes.map((remote) => <option key={remote.name} value={remote.name}>{remote.name}{remote.test ? ' · test' : ''}</option>)}
          </select>
        </label>
        <nav className="path-crumbs" aria-label="Percorso remoto">
          <button onClick={() => onNavigate(index, pane.remote, '')} aria-label="Radice"><Home size={14} /><span>{pane.remote || 'Root'}</span></button>
          {segments.map((segment, segmentIndex) => (
            <React.Fragment key={`${segment}-${segmentIndex}`}>
              <ChevronRight size={13} aria-hidden="true" />
              <button onClick={() => onNavigate(index, pane.remote, segments.slice(0, segmentIndex + 1).join('/'))}>{segment}</button>
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
                  <button className="file-name-button" onDoubleClick={() => entry.is_dir && onNavigate(index, pane.remote, entry.path)} onClick={() => entry.is_dir && onNavigate(index, pane.remote, entry.path)} title={entry.is_dir ? `Apri ${entry.name}` : entry.name}>
                    {entry.is_dir ? <Folder size={17} className="folder-icon" /> : <File size={17} className="file-icon" />}
                    <span>{entry.name}</span>
                  </button>
                </td>
                <td className="size-column">{entry.is_dir ? '—' : formatSize(entry.size)}</td>
                <td className="type-column">{entry.is_dir ? 'Cartella' : 'File'}</td>
                <td className="date-column">{formatDate(entry.mod_time)}</td>
                <td className="action-column"><button
                  className="row-action"
                  disabled={busy || !target}
                  onClick={() => onTransfer(index, entry, 1 - index)}
                  aria-label={`${mode === 'copy' ? 'Copia' : 'Sposta'} ${entry.name} verso ${target || 'l’altro pannello'}`}
                  title={`${mode === 'copy' ? 'Copia' : 'Sposta'} verso ${target || 'l’altro remote'}`}
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
      <footer className="pane-footer"><span>{pane.remote ? `${pane.entries.length} elementi` : 'Seleziona un remote'}</span><span>{index === 0 ? '01 / Sorgente' : '02 / Destinazione'}</span></footer>
    </section>
  );
}

function JobsWorkspace({ jobs, remotes, busy, onCreate, onRun }) {
  return (
    <section className="workspace-view" aria-labelledby="jobs-title">
      <div className="page-heading"><div><h1 id="jobs-title">Job di sincronizzazione</h1><p>Salva una configurazione di trasferimento e avviala quando serve.</p></div><button className="primary-button" onClick={onCreate} disabled={remotes.length < 2}><Plus size={16} />Nuovo job</button></div>
      {jobs.length ? (
        <div className="jobs-table-wrap">
          <table className="jobs-table">
            <thead><tr><th scope="col">Nome</th><th scope="col">Operazione</th><th scope="col">Percorso</th><th scope="col">Ultimo esito</th><th scope="col"><span className="sr-only">Avvia</span></th></tr></thead>
            <tbody>{jobs.map((job) => (
              <tr key={job.id}>
                <td><strong>{job.name}</strong><span className="job-sub">{job.last_run ? `Ultima esecuzione ${formatDate(job.last_run)}` : 'Non ancora eseguito'}</span></td>
                <td><span className={`job-mode ${job.mode}`}>{job.mode === 'sync' ? 'Sincronizza' : 'Copia'}</span></td>
                <td><span className="job-route">{job.source_remote}:{job.source_path || '/'}<ArrowRight size={14} />{job.destination_remote}:{job.destination_path || '/'}</span></td>
                <td><span className={`job-status ${job.status}`}><span className="status-dot" />{job.status === 'success' ? 'Completato' : job.status === 'failed' ? 'Errore' : job.status === 'running' ? 'In esecuzione' : 'Pronto'}</span>{job.last_result && <span className="job-result">{job.last_result}</span>}</td>
                <td><button className="run-button" disabled={busy || job.status === 'running'} onClick={() => onRun(job)}><Play size={14} fill="currentColor" />Esegui</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="empty-jobs"><div className="empty-line"><Clock3 size={19} /><span>Nessun job salvato</span></div><p>Crea un job di copia o sincronizzazione tra due remote. La sincronizzazione può eliminare file presenti solo nella destinazione.</p><button className="primary-button" onClick={onCreate} disabled={remotes.length < 2}><Plus size={16} />Crea il primo job</button>{remotes.length < 2 && <span className="inline-note">Configura almeno due remote per creare un job.</span>}</div>
      )}
    </section>
  );
}

function SettingsWorkspace({ remotes, onAdd, onEdit, flash, setError, refresh }) {
  const [config, setConfig] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/config').then((result) => setConfig(result.content)).catch((requestError) => setError(requestError.message));
  }, []);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const result = await api('/config', { method: 'PUT', body: JSON.stringify({ content: config }) });
      await refresh();
      flash(`Configurazione salvata · ${result.remotes} remote`);
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

  return (
    <section className="workspace-view" aria-labelledby="settings-title">
      <div className="page-heading"><div><h1 id="settings-title">Configurazione</h1><p>Gestisci i remote e il file standard di rclone.</p></div><button className="primary-button" onClick={onAdd}><Plus size={16} />Nuovo remote</button></div>
      <section className="settings-section" aria-labelledby="remote-list-title">
        <div className="section-heading"><div><h2 id="remote-list-title">Remote configurati</h2><p>Le credenziali restano nel file privato di rclone.</p></div><span className="section-count">{remotes.length} {remotes.length === 1 ? 'remote' : 'remote'}</span></div>
        {remotes.length ? <div className="remote-table-wrap"><table className="remote-table"><thead><tr><th scope="col">Remote</th><th scope="col">Backend</th><th scope="col">Stato</th><th scope="col"><span className="sr-only">Modifica</span></th></tr></thead><tbody>{remotes.map((remote) => (
          <tr key={remote.name}><td><span className="remote-name"><HardDrive size={16} />{remote.name}</span></td><td>{remote.type}{remote.test && <span className="test-badge">Remote di test</span>}</td><td><span className="job-status success"><span className="status-dot" />Configurato</span></td><td><button className="secondary-button compact" onClick={() => onEdit(remote)}>Modifica</button></td></tr>
        ))}</tbody></table></div> : <div className="empty-remote"><HardDrive size={24} /><strong>Nessun remote</strong><span>Crea un remote con il wizard o importa un file rclone.conf.</span></div>}
      </section>

      <section className="settings-section config-section" aria-labelledby="config-title">
        <div className="section-heading"><div><h2 id="config-title">File rclone.conf</h2><p>Importa o modifica la configurazione INI compatibile con rclone.</p></div><button className="secondary-button" onClick={exportConfig}><ArrowDownToLine size={15} />Esporta</button></div>
        <label className="sr-only" htmlFor="rclone-config">Configurazione rclone</label>
        <textarea id="rclone-config" className="config-editor" spellCheck="false" value={config} onChange={(event) => setConfig(event.target.value)} placeholder={'[mio-remote]\ntype = drive'} />
        <div className="config-actions"><span>Il file può contenere token e password. Trattalo come un segreto.</span><button className="primary-button" disabled={saving} onClick={saveConfig}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}Salva configurazione</button></div>
      </section>
    </section>
  );
}

function RemoteWorkspace({ providers, remote, onCancel, onSubmit }) {
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

  return (
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
        <div className="form-field"><label htmlFor="remote-name">Nome remote</label><input id="remote-name" required disabled={Boolean(remote)} value={name} onChange={(event) => setName(event.target.value)} pattern="[A-Za-z0-9_.-]{1,64}" placeholder="es. archivio" /><span>Lettere, numeri, punto, trattino e underscore.</span></div>
        <div className="provider-picker">
          <div className="provider-picker-heading">
            <div><h3 id="provider-picker-title">Provider</h3><p>Scegli il servizio da collegare al remote.</p></div>
            <span>{sortedProviders.length} disponibili</span>
          </div>
          <label className="provider-search-label" htmlFor="provider-search">Cerca tra i provider</label>
          <div className="provider-search-input"><Search size={17} aria-hidden="true" /><input id="provider-search" type="search" disabled={Boolean(remote)} value={providerSearch} onChange={(event) => { setProviderSearch(event.target.value); setShowAllProviders(false); }} placeholder="Nome o descrizione, per esempio S3" /></div>
          <span className="provider-search-status" aria-live="polite">{remote ? 'Il provider configurato non è modificabile.' : providerSearch.trim() ? filteredProviders.length ? `${filteredProviders.length} risultati` : 'Nessun provider trovato.' : 'Cerca per nome o descrizione.'}</span>
          {showingProviderResults ? (
            <>
              <div className="provider-results-heading"><strong>{providerSearch.trim() ? 'Risultati' : 'Tutti i provider'}</strong><span>{filteredProviders.length}</span></div>
              <div className="provider-results" aria-label="Risultati provider">
                {filteredProviders.length ? filteredProviders.map((provider) => {
                  const providerName = provider.Name || provider.name;
                  const isSelected = providerName === type;
                  return <button key={providerName} type="button" className={`provider-result ${isSelected ? 'is-selected' : ''}`} aria-pressed={isSelected} onClick={() => { setType(providerName); setProviderSearch(''); setShowAllProviders(false); setTestRoot(providerName === 'local'); setOptions({}); }}>
                    <span className="provider-result-copy"><strong className="provider-result-name">{providerName}</strong>{provider.Description && <span className="provider-result-description">{provider.Description}</span>}</span>
                    {isSelected && <Check size={16} aria-hidden="true" />}
                  </button>;
                }) : <div className="provider-results-empty"><span>Nessun provider corrisponde alla ricerca.</span><button type="button" className="text-button" onClick={() => { setProviderSearch(''); setShowAllProviders(false); }}>Cancella ricerca</button></div>}
              </div>
            </>
          ) : (
            <div className="provider-current" role="status">
              <span className="provider-current-icon"><HardDrive size={17} /></span>
              <span className="provider-current-copy"><small>Provider selezionato</small><strong>{selected?.Name || type}</strong>{selected?.Description && <span>{selected.Description}</span>}</span>
              {remote ? <span className="provider-current-status"><Check size={15} />Configurato</span> : <button type="button" className="secondary-button compact" onClick={() => setShowAllProviders(true)}><Search size={14} />Cambia</button>}
            </div>
          )}
        </div>
        {showingProviderResults ? (
          <p className="provider-selection-hint" role="status">Provider attuale: <strong>{selected?.Name || type}</strong>. Seleziona un risultato per configurare la connessione.</p>
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
  );
}

function JobModal({ remotes, onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [sourceRemote, setSourceRemote] = useState(remotes[0]?.name || '');
  const [destinationRemote, setDestinationRemote] = useState(remotes[1]?.name || '');
  const [sourcePath, setSourcePath] = useState('');
  const [destinationPath, setDestinationPath] = useState('');
  const [mode, setMode] = useState('copy');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    await onSubmit({ name, source_remote: sourceRemote, source_path: sourcePath, destination_remote: destinationRemote, destination_path: destinationPath, mode });
    setSaving(false);
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="job-dialog-title" onSubmit={submit}>
        <div className="dialog-heading"><div><h2 id="job-dialog-title">Nuovo job</h2><p>Salva un’operazione da avviare manualmente.</p></div><button type="button" className="icon-button" aria-label="Chiudi" onClick={onClose}><X size={18} /></button></div>
        <div className="form-field"><label htmlFor="job-name">Nome</label><input id="job-name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="es. Archivio documenti" /></div>
        <div className="job-form-grid">
          <div className="form-field"><label htmlFor="job-source">Remote sorgente</label><select id="job-source" value={sourceRemote} onChange={(event) => setSourceRemote(event.target.value)} required>{remotes.map((remote) => <option key={remote.name} value={remote.name}>{remote.name}</option>)}</select></div>
          <div className="form-field"><label htmlFor="job-source-path">Cartella sorgente</label><input id="job-source-path" value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="Radice del remote" /></div>
          <div className="form-field"><label htmlFor="job-destination">Remote destinazione</label><select id="job-destination" value={destinationRemote} onChange={(event) => setDestinationRemote(event.target.value)} required>{remotes.map((remote) => <option key={remote.name} value={remote.name}>{remote.name}</option>)}</select></div>
          <div className="form-field"><label htmlFor="job-destination-path">Cartella destinazione</label><input id="job-destination-path" value={destinationPath} onChange={(event) => setDestinationPath(event.target.value)} placeholder="Radice del remote" /></div>
        </div>
        <div className="form-field"><label htmlFor="job-mode">Operazione</label><select id="job-mode" value={mode} onChange={(event) => setMode(event.target.value)}><option value="copy">Copia · conserva la sorgente</option><option value="sync">Sincronizza · allinea la destinazione</option></select></div>
        {mode === 'sync' && <div className="alert alert-warning"><TriangleAlert size={17} /><span>La sincronizzazione può eliminare dalla destinazione i file non presenti nella sorgente. Verrà chiesta conferma prima di ogni esecuzione.</span></div>}
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Annulla</button><button className="primary-button" disabled={saving || remotes.length < 2}>{saving && <LoaderCircle size={16} className="spin" />}Crea job</button></div>
      </form>
    </ModalBackdrop>
  );
}

function SyncConfirm({ job, busy, onCancel, onConfirm }) {
  return (
    <ModalBackdrop onClose={onCancel}>
      <section className="dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="sync-confirm-title" aria-describedby="sync-confirm-description">
        <div className="warning-mark"><TriangleAlert size={21} /></div>
        <h2 id="sync-confirm-title">Confermi la sincronizzazione?</h2>
        <p id="sync-confirm-description">“{job.name}” renderà la destinazione identica alla sorgente e può eliminare i file presenti solo in {job.destination_remote}.</p>
        <div className="dialog-actions"><button className="secondary-button" onClick={onCancel} disabled={busy}>Annulla</button><button className="danger-button" onClick={onConfirm} disabled={busy}>{busy ? 'Sincronizzazione…' : 'Conferma ed esegui'}</button></div>
      </section>
    </ModalBackdrop>
  );
}

createRoot(document.getElementById('root')).render(<App/>);
