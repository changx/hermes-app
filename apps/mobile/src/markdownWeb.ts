import { getRandomBytes } from 'expo-crypto';
import { KATEX_CSS, KATEX_SCRIPT, MERMAID_SCRIPT } from './markdownRenderer.generated';

/** Bundled engines/data only; the bridge returns fixed render status, never commands. */
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
      `const result=await mermaid.render('message-diagram',${data});const el=document.getElementById('content');el.innerHTML=result.svg;const svg=el.querySelector('svg');if(!svg)throw Error('diagram unavailable');` +
      `const vb=svg.viewBox&&svg.viewBox.baseVal;const rect=svg.getBoundingClientRect();` +
      `const baseWidth=Math.max(1,vb&&vb.width||rect.width||320),baseHeight=Math.max(1,vb&&vb.height||rect.height||220);` +
      `let zoom=1;const resize=()=>{svg.style.maxWidth='none';svg.style.width=Math.round(baseWidth*zoom)+'px';svg.style.height=Math.round(baseHeight*zoom)+'px'};resize();` +
      `document.getElementById('zoom-in').addEventListener('click',()=>{zoom=Math.min(4,Math.round((zoom+0.25)*100)/100);resize()});` +
      `document.getElementById('zoom-out').addEventListener('click',()=>{zoom=Math.max(0.5,Math.round((zoom-0.25)*100)/100);resize()});` +
      `document.getElementById('zoom-reset').addEventListener('click',()=>{zoom=1;resize()});`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1${kind === 'diagram' ? ',maximum-scale=5,user-scalable=yes' : ',maximum-scale=1'}">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; font-src data:; img-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">` +
    `<style>html,body{margin:0;padding:0;background:transparent;color:#172a40;font:15px system-ui}` +
    `body{overflow:auto}#content{padding:8px;min-width:min-content}svg{max-width:none}` +
    (kind === 'diagram' ? `#zoom-controls{position:fixed;top:4px;right:4px;z-index:10;display:flex;gap:4px}` +
      `#zoom-controls button{background:#fff;color:#172a40;border:1px solid #9ab2d2;border-radius:6px;min-width:38px;min-height:38px;font:15px system-ui}` : '') +
    css + `</style></head><body>` + (kind === 'diagram' ? `<div id="zoom-controls"><button id="zoom-in" aria-label="放大">放大</button><button id="zoom-out" aria-label="缩小">缩小</button><button id="zoom-reset" aria-label="重置">重置</button></div>` : '') + `<div id="content"></div>` +
    `<script nonce="${nonce}">${engine}</script><script nonce="${nonce}">(async()=>{try{${draw}` +
    `if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage('render-ready');}catch(e){` +
    `const el=document.getElementById('content');el.textContent='暂时无法显示：'+${data};` +
    `if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage('render-failed');}})();</script></body></html>`;
}
