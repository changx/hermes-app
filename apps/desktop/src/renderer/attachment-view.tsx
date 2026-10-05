import { useRef, useState } from 'react';
import type { DesktopAttachment } from '../shared/desktop-api';
import { ThumbnailFace, useAttachmentImage } from './attachment-thumbnail';

export const AttachmentView = ({ attachment }: { attachment: DesktopAttachment }) => {
  const host = useRef<HTMLDivElement>(null);
  const { image, src, failed, fail, retry } = useAttachmentImage(host, attachment);
  const [actionError, setActionError] = useState('');
  const preview = () => { setActionError(''); void window.hermesDesktop.previewAttachment(attachment.id).catch(() => setActionError('The file could not be previewed. Try Save or Open externally.')); };
  const open = () => { setActionError(''); void window.hermesDesktop.downloadAttachment(attachment.id, 'open').catch(() => setActionError('The file could not be opened. Try again.')); };
  return <div className="attachment-card" ref={host}>
    {image && attachment.state === 'available' ? <button className="attachment-image" type="button" onClick={failed ? retry : preview} aria-label={failed ? `Retry image: ${attachment.name}` : `Preview image: ${attachment.name}`}>
      {src ? <img src={src} alt={attachment.name} onError={fail} /> : <span>{failed ? 'Image couldn’t load. Click to retry.' : 'Loading image…'}</span>}
    </button> : null}
    <div className="attachment-row"><ThumbnailFace name={attachment.name} mime={attachment.mime} src={src} failed={failed} onError={fail} /><span className="attachment-name">{attachment.name}</span><span className="attachment-size">{attachment.size ? `${Math.ceil(attachment.size / 1024)} KB` : attachment.state}</span>
      {attachment.state === 'available' ? <><button type="button" onClick={preview}>Preview</button><button type="button" onClick={open}>Open externally</button><button type="button" onClick={() => { void window.hermesDesktop.downloadAttachment(attachment.id, 'save').catch(() => setActionError('The file could not be saved. Try again.')); }}>Save</button>{attachment.publicUrl ? <a href={attachment.publicUrl} target="_blank" rel="noreferrer">View file</a> : null}</> : null}
    </div>
    {actionError ? <p role="alert">{actionError}</p> : null}
  </div>;
};
