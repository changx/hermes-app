import { createContext, memo, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { getMermaid } from "./mermaid-engine";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { remarkStrictInlineMath } from "./strict-inline-math";
import { isSessionLinkHref, remarkSessionLinks } from "../../../../packages/client/src/sessionLinks";
import { wrapsCodeLines } from "../../../../packages/client/src/codeBlocks";
import { MessageIcon } from "./message-toolbar";
import { ClickCopy, InCodeBlock, useCopyNote } from "./click-copy";

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

type HastNode = { type: string; value?: string; children?: readonly HastNode[] };
const nodeText = (node: HastNode | undefined): string =>
  !node ? "" : node.type === "text" ? node.value ?? "" : (node.children ?? []).map(nodeText).join("");

/** Copy button on a multi-line code block. It sits outside the scrolling `pre`, so it stays in the top-right corner. */
const CodeCopy = ({ text }: { text: string }) => {
  const { note, copy } = useCopyNote();
  return <div className="code-copy">
    {note && <span className="code-copy-note" role="status">{note}</span>}
    <button type="button" aria-label="Copy code" title="Copy" onClick={() => copy(text)}><MessageIcon name="copy" /></button>
  </div>;
};

/** Inline code copies on click, except inside a link, where a click opens the link. */
const InLink = createContext(false);
const InlineCode = ({ className, children }: { className?: string; children: ReactNode }) => {
  const block = useContext(InCodeBlock), link = useContext(InLink);
  if (block || link) return <code className={className}>{children}</code>;
  return <ClickCopy as="code" className={className} text={String(children)}>{children}</ClickCopy>;
};

// Stable component functions keep code/diagram subtrees mounted across updates.
const markdownComponents: Components = {
  table: ({ children }) => <div className="markdown-table" role="region" aria-label="Scrollable table" tabIndex={0}><table>{children}</table></div>,
  a: ({ href, children }) => {
    const safe = allowedLink(href);
    if (safe && isSessionLinkHref(safe)) return <InLink.Provider value><a href={safe} onClick={event => { event.preventDefault(); void window.hermesDesktop?.openSessionLink?.(safe)?.catch(() => {}); }}>{children}</a></InLink.Provider>;
    return safe ? <InLink.Provider value><a href={safe} target="_blank" rel="noreferrer">{children}</a></InLink.Provider> : <span>{children}</span>;
  },
  img: ({ alt }) => <span className="blocked-image">[Image: {alt || "attachment"}]</span>,
  code: ({ className, children }) => {
    const language = /language-([^ ]+)/.exec(className ?? "")?.[1];
    const source = String(children).replace(/\n$/, "");
    return language === "mermaid" ? <MermaidDiagram source={source} /> : <InlineCode className={className}>{children}</InlineCode>;
  },
  pre: ({ node, children }) => {
    const code = node?.children?.[0];
    const classes = code?.type === "element" ? code.properties?.className : undefined;
    const language = (Array.isArray(classes) ? classes : []).map(String).find(name => name.startsWith("language-"))?.slice(9);
    const className = wrapsCodeLines(language) ? "code-block code-block-wrap" : "code-block";
    const inner = <InCodeBlock.Provider value>{children}</InCodeBlock.Provider>;
    if (language === "mermaid") return <pre className={className}>{inner}</pre>;
    const text = nodeText(code).replace(/\n$/, "");
    // A one-line block copies on a click anywhere in the line; longer blocks keep the corner button.
    if (!text.includes("\n")) return <ClickCopy as="pre" className={`${className} code-block-line`} text={text}>{inner}</ClickCopy>;
    return <div className="code-block-frame"><pre className={className}>{inner}</pre><CodeCopy text={text} /></div>;
  },
};
// A Markdown file preview shows its images: web images and plain sibling file names,
// which the preview page resolves only against the same Session's image attachments.
const documentImage = (url: string): string | undefined => allowedLink(url) ?? (/^[^/\\:?#]+\.(png|jpe?g|gif|webp)$/i.test(url) ? url : undefined);
const documentComponents: Components = {
  ...markdownComponents,
  img: ({ src, alt }) => typeof src === "string" && src ? <img src={src} alt={alt ?? ""} loading="lazy" /> : <span className="blocked-image">[Image: {alt || "attachment"}]</span>,
};
const remarkPlugins = [remarkGfm, remarkMath, remarkStrictInlineMath, remarkSessionLinks];
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
