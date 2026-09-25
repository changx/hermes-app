import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('package.json'));
const WebSocket = require('ws');
/** Node desktop test transport; a shipped Electron shell must keep the token in its secure process. */
export function desktopTransport(base) {
  return {
    http: { async request(method, route, token, body, signal) {
      const response = await fetch(base + route, {method, headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal});
      const raw=await response.text(); return {status:response.status,body:raw ? (response.headers.get('content-type')?.includes('json') ? JSON.parse(raw) : raw) : null};
    }},
    socket: { connect(route,token,signal) { return new Promise((resolve,reject)=>{
      const ws = new WebSocket(base.replace(/^http/,'ws')+route,{headers:{Authorization:'Bearer '+token}});
      const abort=()=>{ws.close();reject(new Error('aborted'))}; signal.addEventListener('abort',abort,{once:true});
      const pending=[]; let listener=null; let closed=false; let closeListener=null;
      ws.on('message',d=>{const value=String(d);if(listener)listener(value);else pending.push(value)});
      ws.on('close',()=>{closed=true;closeListener?.()});
      ws.once('open',()=>{signal.removeEventListener('abort',abort);resolve({onMessage(fn){listener=fn;for(const value of pending.splice(0))fn(value)},onClose(fn){closeListener=fn;if(closed)fn()},close(){ws.close()}})});
      ws.once('error',reject);
    }) }}
  };
}
