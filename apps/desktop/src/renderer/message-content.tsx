import { memo, useEffect, useId, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

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
    void import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", htmlLabels: false, maxTextSize: 20_000, theme: "neutral" });
      const { svg } = await mermaid.render(`diagram${id}`, source);
      if (active && host.current) host.current.innerHTML = sanitizeDiagram(svg);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [id, source]);
  return error ? <pre className="code-block"><code>{source}</code><small>Diagram preview unavailable</small></pre> : <div ref={host} className="mermaid-diagram" role="img" aria-label="Mermaid diagram" />;
};

const allowedLink = (href: string | undefined): string | undefined => {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
};

export const MessageContent = memo(({ text }: { text: string }) => (
  <div className="message-markdown">
  <ReactMarkdown
    skipHtml
    remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[rehypeKatex]}
    urlTransform={(url) => allowedLink(url) ?? ""}
    components={{
      a: ({ href, children }) => {
        const safe = allowedLink(href);
        return safe ? <a href={safe} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
      },
      img: ({ alt }) => <span className="blocked-image">[Image: {alt || "attachment"}]</span>,
      code: ({ className, children, ...props }) => {
        const language = /language-([^ ]+)/.exec(className ?? "")?.[1];
        const source = String(children).replace(/\n$/, "");
        return language === "mermaid" ? <MermaidDiagram source={source} /> : <code className={className} {...props}>{children}</code>;
      },
      pre: ({ children }) => <pre className="code-block">{children}</pre>,
    }}
  >{text}</ReactMarkdown>
  </div>
));
