import { useRef, useState } from 'react';
import type { DesktopAttachment } from '../shared/desktop-api';
import { ThumbnailFace, useAttachmentImage } from './attachment-thumbnail';

export const AttachmentView = ({ attachment }: { attachment: DesktopAttachment }) => {
  const host = useRef<HTMLDivElement>(null);
  const { image, src, failed, fail, retry } = useAttachmentImage(host, attachment);
  const [actionError, setActionError] = useState('');
  const preview = () => { setActionError(''); void window.hermesDesktop.previewAttachment(attachment.id).catch(() => setActionError('The file could not be previewed. Try Save or Open externally.')); };
  const open = () => { setActionError(''); void window.hermesDesktop.downloadAttachment(attachment.id, 'open').catch(() => setActionError('The file could not be opened. Try again.')); };
  const save = () => { setActionError(''); void window.hermesDesktop.downloadAttachment(attachment.id, 'save').catch(() => setActionError('The file could not be saved. Try again.')); };
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
        <button type="button" onClick={open} data-tooltip="Open in the default app">Open externally</button>
        <button type="button" onClick={save} data-tooltip="Save a copy to this computer">Save</button>
        {attachment.publicUrl ? <a href={attachment.publicUrl} target="_blank" rel="noreferrer" data-tooltip="Open the file link">View file</a> : null}
      </div> : null}
    </div>
    {actionError ? <p role="alert">{actionError}</p> : null}
  </div>;
};
