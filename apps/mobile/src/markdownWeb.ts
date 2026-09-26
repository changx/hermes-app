import { getRandomBytes } from 'expo-crypto';
import { KATEX_CSS, KATEX_SCRIPT, MERMAID_SCRIPT } from './markdownRenderer.generated';

/** No remote documents, resources, bridge or navigation: only bundled engines and data. */
export function renderMarkdownHtml(kind: 'math' | 'diagram', source: string, display = true): string {
  // Do not initialize multi-megabyte engines for oversized or untrusted input.
  if (source.length > (kind === 'math' ? 4096 : 6000)) {
    const excerpt = source.slice(0, 6000).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'"></head><body><pre>${excerpt}\n…</pre></body></html>`;
  }
  const nonce = Array.from(getRandomBytes(24), byte => byte.toString(16).padStart(2, '0')).join('');
  const data = JSON.stringify(source).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const engine = (kind === 'math' ? KATEX_SCRIPT : MERMAID_SCRIPT).replace(/<\/script/gi, '<\\/script');
  const css = kind === 'math' ? KATEX_CSS : '';
  const draw = kind === 'math'
    ? `document.getElementById('content').innerHTML=katex.renderToString(${data},{displayMode:${display},throwOnError:true,trust:false,maxExpand:1000});`
    : `mermaid.initialize({startOnLoad:false,securityLevel:'strict',secure:['securityLevel','maxTextSize','maxEdges','htmlLabels'],htmlLabels:false,maxTextSize:6000,maxEdges:100,theme:'default'});` +
      `const result=await mermaid.render('message-diagram',${data});document.getElementById('content').innerHTML=result.svg;`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; font-src data:; img-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">` +
    `<style>html,body{margin:0;padding:0;background:transparent;color:#172a40;font:15px system-ui}` +
    `body{overflow:auto}#content{padding:8px;min-width:min-content}svg{max-width:none}` + css + `</style></head><body><div id="content"></div>` +
    `<script nonce="${nonce}">${engine}</script><script nonce="${nonce}">(async()=>{try{${draw}}catch(e){` +
    `const el=document.getElementById('content');el.textContent='暂时无法显示：'+${data};}})();</script></body></html>`;
}
