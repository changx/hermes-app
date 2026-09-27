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
      `
      // Persist SVG scale, rather than relying on WKWebView's page zoom/bounce.
      const stage=document.getElementById('diagram-stage');
      const fit=()=>Math.min(1,Math.max(1,stage.clientWidth-16)/baseWidth,Math.max(1,stage.clientHeight-16)/baseHeight);
      let zoom=fit(),manual=false,pinch=null;
      const resize=()=>{svg.style.maxWidth='none';svg.style.width=(baseWidth*zoom)+'px';svg.style.height=(baseHeight*zoom)+'px'};
      const apply=(next,x,y)=>{
        const old=zoom,anchorX=(stage.scrollLeft+x-8)/old,anchorY=(stage.scrollTop+y-8)/old;
        zoom=Math.max(fit()/4,Math.min(4,next));manual=true;resize();
        stage.scrollLeft=anchorX*zoom+8-x;stage.scrollTop=anchorY*zoom+8-y;
      };
      const reset=()=>{manual=false;zoom=fit();resize();stage.scrollLeft=0;stage.scrollTop=0};
      resize();
      document.getElementById('zoom-in').addEventListener('click',()=>apply(zoom*1.25,stage.clientWidth/2,stage.clientHeight/2));
      document.getElementById('zoom-out').addEventListener('click',()=>apply(zoom/1.25,stage.clientWidth/2,stage.clientHeight/2));
      document.getElementById('zoom-reset').addEventListener('click',reset);
      const points=e=>{
        if(e.touches.length!==2)return null;
        const a=e.touches[0],b=e.touches[1],r=stage.getBoundingClientRect();
        return {distance:Math.max(1,Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)),x:(a.clientX+b.clientX)/2-r.left,y:(a.clientY+b.clientY)/2-r.top};
      };
      stage.addEventListener('touchstart',e=>{
        const p=points(e);if(!p)return;
        e.preventDefault();pinch={...p,zoom,scrollX:stage.scrollLeft,scrollY:stage.scrollTop};
      },{passive:false});
      stage.addEventListener('touchmove',e=>{
        const p=points(e);if(!p||!pinch)return;
        e.preventDefault();
        const next=pinch.zoom*p.distance/pinch.distance;
        zoom=Math.max(fit()/4,Math.min(4,next));manual=true;resize();
        stage.scrollLeft=(pinch.scrollX+pinch.x-8)*zoom/pinch.zoom+8-p.x;
        stage.scrollTop=(pinch.scrollY+pinch.y-8)*zoom/pinch.zoom+8-p.y;
      },{passive:false});
      // Ending/cancelling only clears the fingers, never the chosen scale.
      const end=()=>{pinch=null};
      stage.addEventListener('touchend',end);stage.addEventListener('touchcancel',end);
      for(const type of ['gesturestart','gesturechange','gestureend'])stage.addEventListener(type,e=>e.preventDefault(),{passive:false});
      window.addEventListener('resize',()=>{if(!manual)reset()});`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; font-src data:; img-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">` +
    `<style>html,body{margin:0;padding:0;background:transparent;color:#172a40;font:15px system-ui}` +
    `body{overflow:auto}#content{padding:8px;min-width:min-content}svg{max-width:none}` +
    (kind === 'diagram' ? `html,body{height:100%;overflow:hidden}#diagram-stage{position:absolute;inset:46px 0 0;overflow:auto;touch-action:pan-x pan-y;overscroll-behavior:contain}` +
      `#content{width:max-content;min-width:0}#content svg{display:block}#zoom-controls{position:absolute;top:4px;right:4px;z-index:10;display:flex;gap:4px}` +
      `#zoom-controls button{background:#fff;color:#172a40;border:1px solid #9ab2d2;border-radius:6px;min-width:38px;min-height:38px;font:15px system-ui}` : '') +
    css + `</style></head><body>` + (kind === 'diagram' ? `<div id="zoom-controls"><button id="zoom-in" aria-label="放大">放大</button><button id="zoom-out" aria-label="缩小">缩小</button><button id="zoom-reset" aria-label="重置">重置</button></div><div id="diagram-stage"><div id="content"></div></div>` : `<div id="content"></div>`) +
    `<script nonce="${nonce}">${engine}</script><script nonce="${nonce}">(async()=>{try{${draw}` +
    `if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage('render-ready');}catch(e){` +
    `const el=document.getElementById('content');el.textContent='暂时无法显示：'+${data};` +
    `if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage('render-failed');}})();</script></body></html>`;
}
