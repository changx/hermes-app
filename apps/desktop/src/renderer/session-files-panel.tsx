import { useEffect, useRef, useState } from 'react';
import type { DesktopSessionFile } from '../shared/desktop-api';

type List = 'delivered' | 'uploaded';
type Page = { state: 'loading' | 'ready' | 'failed' | 'unsupported'; items: readonly DesktopSessionFile[]; nextAfter: string | null };
const TABS: readonly { list: List; label: string; empty: string }[] = [
  { list: 'delivered', label: 'Files', empty: 'Hermes has not sent files in this session.' },
  { list: 'uploaded', label: 'Attachments', empty: 'You have not sent files in this session.' },
];
const fileSize = (bytes: number): string => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const fileDate = (seconds: number): string => new Date(seconds * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * The files of this Session (status bar > Session files). Files: what Hermes sent with MEDIA:.
 * Attachments: what the user sent. A click previews the file in the preview sidebar; Open uses
 * the system app; Save asks where to save. Lists come from the server each time the panel opens.
 */
export function SessionFilesPanel({ close }: { close: () => void }) {
  const [list, setList] = useState<List>('delivered'), [error, setError] = useState('');
  const [pages, setPages] = useState<Record<List, Page>>({ delivered: { state: 'loading', items: [], nextAfter: null }, uploaded: { state: 'loading', items: [], nextAfter: null } });
  const alive = useRef(true), busy = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = (target: List, after?: string) => {
    void window.hermesDesktop.listSessionFiles(target, after).then(page => {
      if (!alive.current) return;
      setPages(old => ({ ...old, [target]: page.supported
        ? { state: 'ready', items: after ? [...old[target].items, ...page.items.filter(item => !old[target].items.some(row => row.id === item.id))] : page.items, nextAfter: page.nextAfter }
        : { state: 'unsupported', items: [], nextAfter: null } }));
    }, () => { if (alive.current) setPages(old => ({ ...old, [target]: after ? old[target] : { state: 'failed', items: [], nextAfter: null } })); if (after && alive.current) setError('More files could not be loaded. Try again.'); });
  };
  useEffect(() => { load('delivered'); load('uploaded'); }, []);
  const act = (file: DesktopSessionFile, action: 'preview' | 'open' | 'save') => {
    if (busy.current || file.state !== 'available') return;
    busy.current = true; setError('');
    void window.hermesDesktop.prepareSessionFile(file.id)
      .then(() => action === 'preview' ? window.hermesDesktop.previewAttachment(file.id) : window.hermesDesktop.downloadAttachment(file.id, action))
      .then(() => { if (action === 'preview' && alive.current) close(); },
        () => { if (alive.current) setError(action === 'save' ? 'The file could not be saved.' : 'The file could not be opened. It may no longer be available.'); })
      .finally(() => { busy.current = false; });
  };
  const page = pages[list], tab = TABS.find(item => item.list === list)!;
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}>
    <section className="editor-dialog session-files-panel" role="dialog" aria-modal="true" aria-label="Session files" onMouseDown={event => event.stopPropagation()}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
      <header className="session-files-header"><h2>Session files</h2><button type="button" className="session-files-close" aria-label="Close" onClick={close}>×</button></header>
      <div className="session-files-tabs" role="tablist" aria-label="File lists">
        {TABS.map(item => <button key={item.list} type="button" role="tab" aria-selected={list === item.list} autoFocus={item.list === 'delivered'} onClick={() => { setList(item.list); setError(''); }}>
          {item.label}{pages[item.list].state === 'ready' ? <span className="session-files-count">{pages[item.list].items.length}{pages[item.list].nextAfter ? '+' : ''}</span> : null}</button>)}
      </div>
      <div className="session-files-body" role="tabpanel" aria-label={tab.label}>
        {page.state === 'loading' && <p className="session-files-note" role="status">Loading files…</p>}
        {page.state === 'failed' && <p className="session-files-note" role="alert">The files could not be loaded. Check the connection and open this panel again.</p>}
        {page.state === 'unsupported' && <p className="session-files-note">This connection does not list session files yet.</p>}
        {page.state === 'ready' && !page.items.length && <p className="session-files-note">{tab.empty}</p>}
        {page.items.length > 0 && <ul className="session-files-list">
          {page.items.map(file => <li key={file.id} className={file.state === 'available' ? undefined : 'unavailable'}>
            <button type="button" className="session-file-main" disabled={file.state !== 'available'} onClick={() => act(file, 'preview')} title={file.name}>
              <span className="session-file-name">{file.name}</span>
              <small>{[fileSize(file.size), fileDate(file.createdAt), file.state !== 'available' ? 'No longer available' : undefined].filter(Boolean).join(' · ')}</small>
              {file.caption && <small className="session-file-caption">{file.caption}</small>}
            </button>
            {file.state === 'available' && <span className="session-file-actions">
              <button type="button" className="secondary" aria-label={`Open ${file.name}`} onClick={() => act(file, 'open')}>Open</button>
              <button type="button" className="secondary" aria-label={`Save ${file.name}`} onClick={() => act(file, 'save')}>Save</button>
            </span>}
          </li>)}
        </ul>}
        {page.nextAfter && <button type="button" className="session-files-more" onClick={() => load(list, page.nextAfter!)}>Show more</button>}
      </div>
      {error && <p className="session-files-note" role="alert">{error}</p>}
    </section>
  </div>;
}
