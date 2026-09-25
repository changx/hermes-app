/** Expo/RN target adapter. Inject native WebSocket and fetch from the app shell. */
export function mobileTransport(base, NativeWebSocket, nativeFetch) {
  return {
    http: { async request(method, route, token, body, signal) {
      const response = await nativeFetch(base+route,{method,headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal});
      const raw=await response.text(); return {status:response.status,body:raw ? (response.headers.get('content-type')?.includes('json')?JSON.parse(raw):raw) : null};
    }},
    socket: { connect(route,token,signal) { return new Promise((resolve,reject)=>{
      // React Native's WebSocket constructor supports an options object with headers.
      const ws=new NativeWebSocket(base.replace(/^http/,'ws')+route,undefined,{headers:{Authorization:'Bearer '+token}});
      const abort=()=>{ws.close();reject(new Error('aborted'))}; signal.addEventListener('abort',abort,{once:true});
      const pending=[]; let listener=null; let closed=false; let closeListener=null;
      ws.onmessage=e=>{const value=String(e.data);if(listener)listener(value);else pending.push(value)};
      ws.onclose=()=>{closed=true;closeListener?.()};
      ws.onopen=()=>{signal.removeEventListener('abort',abort);resolve({onMessage(fn){listener=fn;for(const value of pending.splice(0))fn(value)},onClose(fn){closeListener=fn;if(closed)fn()},close(){ws.close()}})};
      ws.onerror=()=>reject(new Error('socket connection failed'));
    }) }}
  };
}
