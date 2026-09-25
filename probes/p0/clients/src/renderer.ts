import { JsonRpcGatewayClient, DEFAULT_HEARTBEAT_INTERVAL_MS } from '@hermes/shared'

const client = new JsonRpcGatewayClient({ replay: true })
const el = document.querySelector('#app')
if (!el) throw new Error('missing root')
el.innerHTML = `<h1>Hermes App P0 客户端壳验证</h1>
<p><strong>合成诊断界面：</strong>未连接 Hermes，未运行模型，没有真实历史、通知或凭据。</p>
<p>共享 SDK：<code>JsonRpcGatewayClient</code> 已进入浏览器 bundle；心跳默认间隔 ${DEFAULT_HEARTBEAT_INTERVAL_MS}ms。</p>
<p id="state">连接状态：${client.connectionState}</p>`
