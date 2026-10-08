import { memo, useEffect, useId, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { getMermaid } from "./mermaid-engine";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { isSessionLinkHref, remarkSessionLinks } from "../../../../packages/client/src/sessionLinks";

const allowedSvgTags = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "marker", "defs", "text", "tspan", "foreignObject", "div", "span", "p", "br"]);
const allowedSvgAttributes = new Set(["xmlns", "viewBox", "width", "height", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "transform", "fill", "fill-opacity", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "marker-end", "marker-start", "text-anchor", "dominant-baseline", "class", "id", "role", "aria-label"]);

const sanitizeDiagram = (source: string): string => {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.tagName !== "svg") throw new Error("invalid diagram");
  const visit = (element: Element): void => {
    if (!allowedSvgTags.has(element.tagName)) { element.remove(); return; }
    for (const attribute of [...element.attributes]) {
      if (!allowedSvgAttributes.has(attribute.name) || /url\s*\(|javascript:|data:/i.test(attribute.value)) element.removeAttribute(attribute.name);
    }
    for (const child of [...element.children]) visit(child);
  };
  visit(parsed.documentElement);
  return new XMLSerializer().serializeToString(parsed.documentElement);
};

const MermaidDiagram = ({ source }: { source: string }) => {
  const id = useId().replace(/[^a-z0-9]/gi, "");
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    if (source.length > 20_000) { setError(true); return; }
    setError(false);
    if (host.current) host.current.replaceChildren();
    void getMermaid().then(async mermaid => {
      if (!active) return;
      const { svg } = await mermaid.render(`diagram${id}`, source);
      if (active && host.current) host.current.innerHTML = sanitizeDiagram(svg);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [id, source]);
  return error ? <pre className="code-block"><code>{source}</code><small>Diagram preview unavailable</small></pre> : <div ref={host} className="mermaid-diagram" role="img" aria-label="Mermaid diagram" />;
};

const allowedLink = (href: string | undefined): string | undefined => {
  if (!href) return undefined;
  // Full links name their server; short ones resolve against this tab's Session in main.
  if (isSessionLinkHref(href)) return href;
  try {
    const url = new URL(href);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
};

// Stable component functions keep code/diagram subtrees mounted across updates.
const markdownComponents: Components = {
  table: ({ children }) => <div className="markdown-table" role="region" aria-label="Scrollable table" tabIndex={0}><table>{children}</table></div>,
  a: ({ href, children }) => {
    const safe = allowedLink(href);
    if (safe && isSessionLinkHref(safe)) return <a href={safe} onClick={event => { event.preventDefault(); void window.hermesDesktop?.openSessionLink?.(safe)?.catch(() => {}); }}>{children}</a>;
    return safe ? <a href={safe} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
  },
  img: ({ alt }) => <span className="blocked-image">[Image: {alt || "attachment"}]</span>,
  code: ({ className, children, ...props }) => {
    const language = /language-([^ ]+)/.exec(className ?? "")?.[1];
    const source = String(children).replace(/\n$/, "");
    return language === "mermaid" ? <MermaidDiagram source={source} /> : <code className={className} {...props}>{children}</code>;
  },
  pre: ({ children }) => <pre className="code-block">{children}</pre>,
};
// A Markdown file preview shows its images: web images and plain sibling file names,
// which the preview page resolves only against the same Session's image attachments.
const documentImage = (url: string): string | undefined => allowedLink(url) ?? (/^[^/\\:?#]+\.(png|jpe?g|gif|webp)$/i.test(url) ? url : undefined);
const documentComponents: Components = {
  ...markdownComponents,
  img: ({ src, alt }) => typeof src === "string" && src ? <img src={src} alt={alt ?? ""} loading="lazy" /> : <span className="blocked-image">[Image: {alt || "attachment"}]</span>,
};
const remarkPlugins = [remarkGfm, remarkMath, remarkSessionLinks];
const rehypePlugins = [rehypeKatex];
const transformUrl = (url: string) => allowedLink(url) ?? "";
const transformDocumentUrl = (url: string, key: string) => (key === "src" ? documentImage(url) : allowedLink(url)) ?? "";

/** `document`: a Markdown file preview (images allowed); otherwise a chat message. */
export const MessageContent = memo(({ text, document = false }: { text: string; document?: boolean }) => (
  <div className="message-markdown">
    <ReactMarkdown skipHtml remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}
      urlTransform={document ? transformDocumentUrl : transformUrl} components={document ? documentComponents : markdownComponents}>{text}</ReactMarkdown>
  </div>
));
