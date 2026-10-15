import { useEffect, useRef, useState, type RefObject } from 'react';
import type { DesktopAttachment } from '../shared/desktop-api';
import { MAX_PREVIEW_BYTES } from '../shared/attachment-input';

export function imageThumbnailSupported(name: string, mime = '', local = false): boolean {
  const type = mime.toLowerCase().split(';')[0];
  return /^image\/(png|jpeg|gif|webp)$/.test(type) || local && (!type || type === 'application/octet-stream') && /\.(png|jpe?g|gif|webp)$/i.test(name);
}
export function attachmentTypeLabel(name: string, mime = ''): string {
  const type = mime.toLowerCase();
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|heic|avif)$/i.test(name)) return 'IMG';
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'PDF';
  if (type === 'text/html' || /\.html?$/i.test(name)) return 'HTML';
  if (/\.(zip|gz|tar|7z|rar)$/i.test(name)) return 'ZIP';
  if (/\.(docx?|odt)$/i.test(name)) return 'DOC';
  if (/\.(xlsx?|csv|ods)$/i.test(name)) return 'DATA';
  if (/\.(mp4|mov|webm)$/i.test(name) || type.startsWith('video/')) return 'VIDEO';
  if (/\.(mp3|wav|ogg)$/i.test(name) || type.startsWith('audio/')) return 'AUDIO';
  if (type.startsWith('text/') || /\.(txt|md|json|xml|ya?ml|js|ts|tsx|py|sh|log)$/i.test(name)) return 'TXT';
  return 'FILE';
}
let active = 0;
const waiting: Array<() => void> = [];
async function imageSlot(): Promise<() => void> {
  if (active >= 3) await new Promise<void>(resolve => waiting.push(resolve)); else active++;
  return () => { const next = waiting.shift(); if (next) next(); else active--; };
}

export function useAttachmentImage(host: RefObject<HTMLElement | null>, attachment?: DesktopAttachment, file?: File) {
  const key = file ?? attachment?.id;
  const name = file?.name ?? attachment?.name ?? 'Attachment', mime = file?.type ?? attachment?.mime ?? '';
  // Images above the preview limit show the file face, not an image or a failed thumbnail.
  const size = file?.size ?? attachment?.size ?? 0;
  const image = imageThumbnailSupported(name, mime, !!file) && size <= MAX_PREVIEW_BYTES;
  const [value, setValue] = useState<{ key: typeof key; src?: string; failed?: boolean }>({ key });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setValue({ key });
    if (!image || !host.current || !file && attachment?.state !== 'available') return;
    let alive = true, started = false;
    if (file) {
      let url: string | undefined;
      try {
        if (!file.size || file.size > MAX_PREVIEW_BYTES) throw new Error('Unsupported file size');
        url = URL.createObjectURL(file); setValue({ key, src: url });
      } catch { setValue({ key, failed: true }); }
      return () => { alive = false; if (url) URL.revokeObjectURL(url); };
    }
    const load = async () => {
      if (started) return; started = true;
      const release = await imageSlot();
      try {
        if (!alive) return;
        const src = await window.hermesDesktop.previewAttachmentImage(attachment!.id);
        if (!/^data:image\/(png|jpeg|gif|webp);base64,/.test(src)) throw new Error('Invalid image source');
        if (alive) setValue({ key, src });
      } catch { if (alive) setValue({ key, failed: true }); }
      finally { release(); }
    };
    if (typeof IntersectionObserver === 'undefined') void load();
    else {
      const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void load(); } }, { root: host.current.closest('.message-list'), rootMargin: '200px' });
      observer.observe(host.current);
      return () => { alive = false; observer.disconnect(); };
    }
    return () => { alive = false; };
  }, [key, mime, image, attachment?.state, attempt, host]);
  const current = value.key === key && image && (!!file || attachment?.state === 'available') ? value : { src: undefined, failed: false };
  return { image, src: current.src, failed: !!current.failed, fail: () => setValue({ key, failed: true }), retry: () => setAttempt(n => n + 1) };
}

export function ThumbnailFace({ name, mime, src, failed = false, onError }: { name: string; mime?: string; src?: string; failed?: boolean; onError?: () => void }) {
  const label = attachmentTypeLabel(name, mime);
  return <span className="attachment-thumbnail" role="img" aria-label={`Thumbnail: ${name}`} title={failed ? `${name} — Thumbnail unavailable` : name} data-thumbnail-state={src ? 'image' : failed ? 'error' : 'file'}>
    {src ? <img src={src} alt="" onError={onError} /> : <><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l4 4v16H6zM14 2v5h4" /></svg><small>{label}</small></>}
  </span>;
}
export function AttachmentThumbnail({ attachment, file }: { attachment?: DesktopAttachment; file?: File }) {
  const host = useRef<HTMLSpanElement>(null), image = useAttachmentImage(host, attachment, file);
  return <span ref={host} className="attachment-thumbnail-host"><ThumbnailFace name={file?.name ?? attachment?.name ?? 'Attachment'} mime={file?.type ?? attachment?.mime} src={image.src} failed={image.failed} onError={image.fail} /></span>;
}
