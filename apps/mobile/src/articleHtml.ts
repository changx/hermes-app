import { getRandomBytes } from 'expo-crypto';
import { KATEX_CSS, markdownEngineScript } from './markdownEngines';
import type { Block, Inline, TableCell } from './messageMarkdown';
import { safeLinkUrl } from './messageMarkdown';
import { safeFontScale } from './fontScale';
import type { ToolCall } from '../../../packages/client/src/index';
import { toolDisplayLabel, toolPresentation } from '../../../packages/client/src/toolPresentation';

// One WebView per open article, at most three locally rendered math/diagram nodes.
// These limits apply to the current parsed AST, not separately to nested blocks.
export const ARTICLE_TEXT_LIMIT = 200_000;
export const ARTICLE_RENDER_LIMIT = 3;
const MATH_LIMIT = 4096;
const DIAGRAM_LIMIT = 6000;
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const script = (value: string) => value.replace(/<\/script/gi, '<\\/script');

export type ArticleExpansion = { kind: 'table' | 'diagram'; block: Block };
export type ArticlePage = { html: string; expansions: ArticleExpansion[]; links: string[]; copies: string[] };

export function renderArticleHtml(blocks: Block[], toolCalls?: readonly ToolCall[], scale = 1): ArticlePage {
  const expansions: ArticleExpansion[] = [], links: string[] = [], copies: string[] = [];
  const imageSources = new Set<string>(), videoSources = new Set<string>();
  let rendered = 0, math = false, diagram = false;
  const expand = (kind: 'table' | 'diagram', block: Block) => {
    const index = expansions.push({ kind, block }) - 1;
    return `<button type="button" data-expand="${index}" aria-label="View ${kind === 'table' ? 'table' : 'diagram'} fullscreen">⤢ View ${kind === 'table' ? 'table' : 'diagram'} fullscreen</button>`;
  };
  const formula = (source: string, display: boolean, kind: 'math' | 'diagram') => {
    const allowed = source.length <= (kind === 'math' ? MATH_LIMIT : DIAGRAM_LIMIT) && rendered < ARTICLE_RENDER_LIMIT;
    if (!allowed) {
      const tag = display ? 'pre' : 'span';
      const original = kind === 'math' && !display ? `$${source}$` : source;
      return `<${tag} class="fallback original">${escape(original)}${source.length > (kind === 'math' ? MATH_LIMIT : DIAGRAM_LIMIT) ? '\n(Content too long; showing the original)' : ''}</${tag}>`;
    }
    rendered++;
    if (kind === 'math') math = true; else diagram = true;
    // The source is inert DOM text, never an executable script or raw HTML.
    return `<${display ? 'div' : 'span'} class="${kind === 'math' ? 'formula' : 'diagram'}" data-render="${kind}" data-display="${display}"><span class="original">${escape(source)}</span></${display ? 'div' : 'span'}>`;
  };
  const inline = (nodes: Inline[], inLink = false): string => nodes.map(node => {
    switch (node.kind) {
      case 'text': return escape(node.text);
      case 'break': return '<br>';
      case 'code': return inLink ? `<code>${escape(node.text)}</code>` : `<code class="copyable" data-copy="${copies.push(node.text) - 1}" role="button">${escape(node.text)}</code>`;
      case 'math': return formula(node.text, false, 'math');
      case 'em': case 'strong': return `<${node.kind}>${inline(node.children, inLink)}</${node.kind}>`;
      case 'strike': return `<del>${inline(node.children, inLink)}</del>`;
      case 'link': {
        const href = node.href && safeLinkUrl(node.href);
        if (!href) return inline(node.children, inLink);
        const index = links.push(href) - 1;
        return `<a href="${escape(href)}" data-link="${index}">${inline(node.children, true)}</a>`;
      }
      case 'image': case 'video': {
        const src = node.src && node.src.length <= 2048 && safeLinkUrl(node.src);
        const caption = escape(node.text || (node.kind === 'video' ? 'Video' : 'Unnamed image'));
        if (!src) return `<span class="fallback">${node.kind === 'video' ? 'Video' : 'Image'} unavailable: ${caption}</span>`;
        // Permit only explicit Markdown media, not URLs introduced by diagrams.
        // CSP ignores query/fragment; encode policy delimiters in the path.
        const mediaUrl = new URL(src);
        const policySource = mediaUrl.origin + mediaUrl.pathname.replace(/[;'\"]/g, c => '%' + c.charCodeAt(0).toString(16));
        (node.kind === 'image' ? imageSources : videoSources).add(policySource);
        return node.kind === 'image'
          ? `<figure><img src="${escape(src)}" alt="${caption}" loading="lazy" referrerpolicy="no-referrer"><figcaption>${caption}</figcaption></figure>`
          : `<figure><video src="${escape(src)}" controls preload="none" playsinline>${caption}</video><figcaption>${caption}</figcaption></figure>`;
      }
    }
  }).join('');
  const cell = (value: TableCell, tag: 'td' | 'th') => `<${tag}${value.align ? ` style="text-align:${value.align}"` : ''}>${inline(value.children)}</${tag}>`;
  const content = (items: Block[]): string => items.map(block => {
    switch (block.kind) {
      case 'paragraph': return `<p>${inline(block.children)}</p>`;
      case 'heading': { const level = Math.min(6, Math.max(1, block.level || 1)); return `<h${level}>${inline(block.children)}</h${level}>`; }
      case 'quote': return `<blockquote>${content(block.children)}</blockquote>`;
      case 'list': return `<${block.ordered ? 'ol' : 'ul'}${block.ordered ? ` start="${Number.isSafeInteger(block.start) ? block.start : 1}"` : ''}>${block.items.map((item, index) => `<li>${block.checks[index] === null ? '' : `<span class="check" aria-label="${block.checks[index] ? 'Completed' : 'Not completed'}">${block.checks[index] ? '☑' : '☐'}</span> `}${content(item)}</li>`).join('')}</${block.ordered ? 'ol' : 'ul'}>`;
      case 'code': { const index = copies.push(block.text.replace(/\r?\n$/, '')) - 1; return `<section class="code" data-copy="${index}" role="button" aria-label="${escape(block.language || 'Code')} block. Tap to copy."><div class="code-head"><small>${escape(block.language || 'Code')}</small><small class="copy">Copy</small></div><pre><code>${escape(block.text)}</code></pre></section>`; }
      case 'math': return formula(block.text, true, 'math');
      case 'diagram': return `<section class="diagram-block">${expand('diagram', block)}${formula(block.text, true, 'diagram')}</section>`;
      case 'table': return `<section class="table-block">${expand('table', block)}<div class="table-grid"><table><thead><tr>${block.header.map(c => cell(c, 'th')).join('')}</tr></thead><tbody>${block.rows.map(row => `<tr>${row.map(c => cell(c, 'td')).join('')}</tr>`).join('')}</tbody></table></div></section>`;
      case 'video': return inline([{ kind: 'video', text: block.text, src: block.src }]);
      case 'rule': return '<hr>';
    }
  }).join('');
  // ToolCall.label/detail are server-safe summaries. Never serialize raw arguments/results.
  const tools = toolCalls?.length ? `<section class="tools">${toolCalls.map(call => {
    const { icon: fallbackIcon, command: terminal } = toolPresentation(call.name);
    const icon = call.icon ?? fallbackIcon;
    return `<div class="tool"><span>${icon} ${escape(toolDisplayLabel(call.name, call.label))}${!terminal && call.detail ? ` ${escape(call.detail.replace(/\s+/g, ' '))}` : ''}</span>${terminal && call.detail ? `<pre>${escape(call.detail)}</pre>` : ''}</div>`;
  }).join('')}</section>` : '';
  const body = content(blocks);
  const nonce = Array.from(getRandomBytes(24), byte => byte.toString(16).padStart(2, '0')).join('');
  const runtime = `(()=>{
    // Only explicit taps on known DOM controls send bounded indices to native.
    let start=null;
    document.addEventListener('pointerdown',e=>{start={x:e.clientX,y:e.clientY}},true);
    document.addEventListener('pointercancel',()=>{start=null},true);
    document.addEventListener('click',e=>{
      const a=e.target.closest('a[data-link]'),b=e.target.closest('button[data-expand]'),c=!a&&!b&&e.target.closest('[data-copy]');
      if(!a&&!b&&!c)return;
      e.preventDefault();
      if(!start||Math.abs(e.clientX-start.x)>8||Math.abs(e.clientY-start.y)>8||!window.getSelection().isCollapsed)return;
      const node=a||b||c, index=a?node.dataset.link:b?node.dataset.expand:node.dataset.copy;
      if(!/^(0|[1-9][0-9]*)$/.test(index))return;
      if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage((a?'link:':b?'expand:':'copy:')+index);
      start=null;
    },true);
    (async()=>{let diagramReady=false;for(const el of document.querySelectorAll('[data-render]')){
      const source=el.querySelector('.original').textContent;
      try{
        if(el.dataset.render==='math'){
          el.innerHTML=katex.renderToString(source,{displayMode:el.dataset.display==='true',throwOnError:true,trust:false,maxExpand:1000});
        }else{
          if(!diagramReady){mermaid.initialize({startOnLoad:false,securityLevel:'strict',secure:['securityLevel','maxTextSize','maxEdges','htmlLabels'],htmlLabels:false,maxTextSize:6000,maxEdges:100,theme:'default',themeVariables:{fontSize:'${16 * safeFontScale(scale)}px'}});diagramReady=true;}
          const result=await mermaid.render('article-diagram-'+Array.prototype.indexOf.call(document.querySelectorAll('[data-render="diagram"]'),el),source);
          el.innerHTML=result.svg;
          if(!el.querySelector('svg'))throw Error('diagram unavailable');
        }
      }catch(_){el.querySelector('.original')?.insertAdjacentText('beforebegin','Could not render: ');}
    }})();
  })();`;
  return { expansions, links, copies, html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; font-src data:; img-src data: ${escape([...imageSources].join(' '))}; media-src ${videoSources.size ? escape([...videoSources].join(' ')) : "'none'"}; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'">` +
    `<style>:root{--interface-scale:${safeFontScale(scale)}}html,body{margin:0;background:white;color:#172a40;font:${15 * safeFontScale(scale)}px/1.55 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}body{padding:4px 16px 36px;overflow-wrap:anywhere}p{margin:0 0 12px}h1,h2,h3,h4,h5,h6{line-height:1.3;margin:16px 0 8px}h1{font-size:${23 * safeFontScale(scale)}px}h2{font-size:${21 * safeFontScale(scale)}px}h3{font-size:${19 * safeFontScale(scale)}px}h4{font-size:${17 * safeFontScale(scale)}px}h5{font-size:${16 * safeFontScale(scale)}px}h6{font-size:${15 * safeFontScale(scale)}px}blockquote{border-left:3px solid #9ab2d2;margin:12px 0;padding-left:10px}ul,ol{padding-left:28px}li{margin:4px 0}li p{margin:0}code,pre,.original{font-family:ui-monospace,Menlo,Consolas,monospace}code{background:#dce5f0;color:#20314a;border-radius:3px;padding:1px 4px}.code,.tool pre{background:#e8eef6;border-radius:8px;padding:10px}.code pre code{background:transparent;border-radius:0;padding:0}.code pre,.tool pre{overflow:auto;white-space:pre;margin:0}.diagram{overflow:auto;max-height:50vh}.diagram svg{max-width:100%;height:auto}.fallback{overflow:auto;white-space:pre-wrap;max-height:220px}.formula{overflow:auto}.tools{margin-top:14px;color:#52657c;font-size:${13 * safeFontScale(scale)}px}.tool{margin:4px 0}.tool pre{color:#20314a}.code small{color:#52657c}.code{cursor:pointer;-webkit-tap-highlight-color:rgba(33,92,167,.12)}.code-head{display:flex;justify-content:space-between;gap:8px;margin-bottom:6px}.code .copy{color:#215ca7;font-weight:600}code.copyable{cursor:pointer;-webkit-tap-highlight-color:rgba(33,92,167,.12)}a{color:#215ca7}article,.table-block{min-width:0;max-width:100%}.table-block{width:100%;box-sizing:border-box}.table-grid{width:100%;min-width:0;max-width:100%;box-sizing:border-box;overflow-x:auto;overscroll-behavior-x:contain}table{border-collapse:collapse;width:100%;max-width:100%;table-layout:fixed}td,th{border:1px solid #d6e0ed;min-width:0;padding:8px 2px;vertical-align:top;overflow-wrap:anywhere;word-break:normal}td code,th code{white-space:pre-wrap;overflow-wrap:anywhere}th{background:#e5ecf5}button{display:block;margin-left:auto;background:none;border:0;color:#215ca7;padding:8px;font:${13 * safeFontScale(scale)}px system-ui}figure{margin:8px 0}img,video{display:block;max-width:100%;max-height:320px}figcaption{font-size:${12 * safeFontScale(scale)}px;color:#52657c}hr{border:0;border-top:1px solid #d7e0eb}</style>` + (math ? `<style>${KATEX_CSS}</style><script nonce="${nonce}">${markdownEngineScript('math')}</script>` : '') + (diagram ? `<script nonce="${nonce}">${markdownEngineScript('diagram')}</script>` : '') +
    `</head><body><article>${body}${tools}</article><script nonce="${nonce}">${script(runtime)}</script></body></html>` };
}
