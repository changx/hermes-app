import { useEffect, useRef, useState } from "react";
import type { DesktopAttachment } from "../shared/desktop-api";

let active = 0;
const waiting: Array<() => void> = [];
async function imageSlot(): Promise<() => void> {
  if (active >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  return () => { const next = waiting.shift(); if (next) next(); else active--; };
}

export const AttachmentView = ({ attachment }: { attachment: DesktopAttachment }) => {
  const host = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const image = /^image\/(png|jpeg|gif|webp)$/.test(attachment.mime);
  useEffect(() => {
    setSrc(undefined); setFailed(false);
    if (!image || attachment.state !== "available") return;
    let alive = true, started = false;
    const load = async () => {
      if (started) return;
      started = true;
      const release = await imageSlot();
      try {
        if (!alive) return;
        const data = await window.hermesDesktop.previewAttachmentImage(attachment.id);
        if (alive) setSrc(data);
      } catch { if (alive) setFailed(true); }
      finally { release(); }
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); void load(); }
    }, { root: host.current?.closest(".message-list"), rootMargin: "200px" });
    if (host.current) observer.observe(host.current);
    return () => { alive = false; observer.disconnect(); };
  }, [attachment.id, attachment.mime, attachment.state, attempt, image]);
  const open = () => { void window.hermesDesktop.downloadAttachment(attachment.id, "open").catch(() => setFailed(true)); };
  return <div className="attachment-card" ref={host}>
    {image && attachment.state === "available" ? <button className="attachment-image" type="button" onClick={failed ? () => setAttempt((n) => n + 1) : open} aria-label={failed ? `Retry image: ${attachment.name}` : `Open image: ${attachment.name}`}>
      {src ? <img src={src} alt={attachment.name} onError={() => { setSrc(undefined); setFailed(true); }} /> : <span>{failed ? "Image couldn’t load. Click to retry." : "Loading image…"}</span>}
    </button> : null}
    <div className="attachment-row"><span>{attachment.name}</span><span>{attachment.size ? `${Math.ceil(attachment.size / 1024)} KB` : attachment.state}</span>
      {attachment.state === "available" ? <><button type="button" onClick={open}>Open</button><button type="button" onClick={() => { void window.hermesDesktop.downloadAttachment(attachment.id, "save").catch(() => setFailed(true)); }}>Save</button>{attachment.publicUrl ? <a href={attachment.publicUrl} target="_blank" rel="noreferrer">View file</a> : null}</> : null}
    </div>
    {failed && !image ? <p role="alert">The file couldn’t open. Please try again.</p> : null}
  </div>;
};
