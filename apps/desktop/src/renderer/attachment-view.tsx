import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { DesktopAttachment } from '../shared/desktop-api';
import { ThumbnailFace, useAttachmentImage } from './attachment-thumbnail';

/** The open Session's attachment IDs in message order, read when Preview is clicked. */
export const AttachmentSequence = createContext<(() => string[]) | null>(null);

export const AttachmentView = ({ attachment }: { attachment: DesktopAttachment }) => {
  const host = useRef<HTMLDivElement>(null);
  const sequence = useContext(AttachmentSequence);
  const { image, src, failed, fail, retry } = useAttachmentImage(host, attachment);
  const [actionError, setActionError] = useState('');
  const [transfer, setTransfer] = useState<{ action: 'save' | 'open'; received?: number; total?: number } | null>(null);
  const mounted = useRef(false), stop = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop.current?.(); stop.current = undefined; }; }, []);
  const preview = () => { setActionError(''); void window.hermesDesktop.previewAttachment(attachment.id, sequence?.()).catch(() => setActionError('The file could not be previewed. Try Save or Open externally.')); };
  // Save/Open stream the file to disk; the main process reports progress for this attachment.
  const download = (action: 'save' | 'open') => {
    if (transfer) return;
    setActionError(''); setTransfer({ action });
    stop.current?.();
    stop.current = window.hermesDesktop.onDownloadProgress?.(progress => {
      if (progress.attachmentId === attachment.id && mounted.current) setTransfer({ action, received: progress.received, total: progress.total ?? attachment.size });
    });
    void window.hermesDesktop.downloadAttachment(attachment.id, action)
      .catch(() => { if (mounted.current) setActionError(action === 'save' ? 'The file could not be saved. Try again.' : 'The file could not be opened. Try again.'); })
      .finally(() => { stop.current?.(); stop.current = undefined; if (mounted.current) setTransfer(null); });
  };
  const open = () => download('open');
  const save = () => download('save');
  const available = attachment.state === 'available';
  return <div className="attachment-card" ref={host}>
    {image && available ? <button className="attachment-image" type="button" onClick={failed ? retry : preview} aria-label={failed ? `Retry image: ${attachment.name}` : `Preview image: ${attachment.name}`} data-tooltip={failed ? 'Retry loading the image' : 'Preview in the sidebar'}>
      {src ? <img src={src} alt={attachment.name} onError={fail} /> : <span>{failed ? 'Image couldn’t load. Click to retry.' : 'Loading image…'}</span>}
    </button> : null}
    {/* File name on its own line; all actions on one line below it. */}
    <div className="attachment-row">
      <ThumbnailFace name={attachment.name} mime={attachment.mime} src={src} failed={failed} onError={fail} />
      <div className="attachment-info"><span className="attachment-name">{attachment.name}</span><span className="attachment-size">{attachment.size ? `${Math.ceil(attachment.size / 1024)} KB` : attachment.state}</span></div>
      {available ? <div className="attachment-actions">
        <button type="button" onClick={preview} data-tooltip="Preview in the sidebar">Preview</button>
        <button type="button" onClick={open} disabled={!!transfer} data-tooltip="Open in the default app">Open externally</button>
        <button type="button" onClick={save} disabled={!!transfer} data-tooltip="Save a copy to this computer">Save</button>
        {attachment.publicUrl ? <a href={attachment.publicUrl} target="_blank" rel="noreferrer" data-tooltip="Open the file link">View file</a> : null}
      </div> : null}
    </div>
    {transfer?.received !== undefined ? <TransferProgressView action={transfer.action} received={transfer.received} total={transfer.total} /> : null}
    {actionError ? <p role="alert">{actionError}</p> : null}
  </div>;
};

const megabytes = (bytes: number) => bytes < 10 * 1024 * 1024 ? (bytes / 1048576).toFixed(1) : String(Math.round(bytes / 1048576));

/** "Saving… 45% · 67 of 150 MB" with a thin bar. Shown after the Save dialog, while bytes arrive. */
export const TransferProgressView = ({ action, received, total }: { action: 'save' | 'open'; received: number; total?: number }) => {
  const percent = total ? Math.min(100, Math.floor(received / total * 100)) : undefined;
  const verb = action === 'save' ? 'Saving' : 'Downloading';
  const label = percent === undefined ? `${verb}… ${megabytes(received)} MB` : `${verb}… ${percent}% · ${megabytes(received)} of ${megabytes(total!)} MB`;
  return <div className="attachment-progress" role="progressbar" aria-label={`${verb} file`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={label}>
    <div className="attachment-progress-track"><div className="attachment-progress-fill" style={{ width: `${percent ?? 0}%` }} /></div>
    <span className="attachment-progress-text">{label}</span>
  </div>;
};
