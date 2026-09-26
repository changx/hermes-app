# M1 手机连接循环：隔离客户端调查

范围：仅候选 worktree 的共享 SDK、原生 transport、outbox 与极窄的 App 连接状态；不改运行中的 Expo/Gateway/队列，不关闭网络验收卡。首版标准见 [网络可靠性](m1-network-reliability.md)。

## 开发发布结果

已按当前“改完直接上”授权发布代码 `839eb80`（来源 `308e0b8`），并保留此前原生键盘、几何修正和layout事件崩溃热修。集成目录主控检查：client 21+17项、mobile 62项、TypeScript通过。双平台公网manifest及实际新bundle确认通过，只重启Expo，两个Gateway和插件文件哈希不变。使用当前源码SDK/native transport的35秒公网只读探针收到真实增量事件并完成周期补齐，初次握手后保持online，无再次syncing、无错误；不等同于iPhone路径验收。

证据：私有 `workspace/hermes-app/m1-network-loop-verification/` 下 `release-checks.log`、`release-verification.json`、`probe-public.json`；旧版本和服务指纹保留于 `before.json`。手机若再次等待网络，顶部脱敏诊断可区分具体错误。原iPhone retrying原因仍待现场证据，不宣称所有网络故障已解决。

## 已知证据与未知

- Jamie 的 iPhone 报告“等待网络 / retrying”和“补齐中 / syncing”反复切换，不能发送；这是真机症状，但尚无手机侧脱敏错误类别、HTTP 状态/路由、WS hello/关闭时序及相应 bundle 版本的记录。不能归因于用户网络。
- 父任务只读检查：开发 Gateway 活跃且无近期异常，服务端无待执行；按实际 SDK + nativeTransport 的 Node WS/RN shim 公网探针在默认 30s 心跳下 70s 在线、零错误，历史游标约 2s 追平，约 70 次 GET 无错误。人工缩短 2s 心跳曾遇服务器接收 idle + 5s 事件等待导致的超时，不能外推至默认设置。私有证据保留在 Jamie workspace 的 `hermes-app/m1-network-incident/`，不复制凭据或消息到仓库。
- 源码边界：`live` 的旧 `replayNow()` 在每个事件帧及定期健康检查都设 `syncing`，而 outbox 只在 `online` 唤醒发送；持续事件期间即使 WS 已完成首次 hello/补齐，也可能长期显示补齐、阻碍新的持久待发消息。已用慢 HTTP、事件突发与 outbox 联合回归证明；首次握手/补齐仍不得提前显示在线。
- App 的 SDK `onError` 原为空操作，断线重试只显示笼统状态，手机侧无法区分 HTTP、超时、WS/协议；本轮改为安全的临时屏幕诊断，不是远程日志。

## 验证结果与诊断入口

- 已证实的独立客户端缺陷：在已经 `online` 的 WS 上，读收据事件触发的慢 `GET /v1/snapshot` 尚未完成时，旧 `replayNow()` 将状态改为 `syncing`；持久 `box.enqueue()` 后 outbox 因非 `online` 不提交。实际源码 SDK + nativeTransport + MobileOutbox 联合测试先 RED（待发送超时），小修后 GREEN：已完成首次 hello/追平的健康 socket 在后台增量同步期间维持 `online`，原文和同一 ID 在慢 GET 未完成时可发；首次 hello/追平仍必须完成才在线，catchup 失败仍退出 socket 并走错误/重试或阻断。此复现证明可造成补齐中阻碍发送，但不能证明 iPhone 的“等待网络”根因。
- SDK 导出安全诊断并在 App `onError` 的主聊天屏幕顶部现有红色错误行显示：仅 HTTP 状态与白名单路由、网络传输/WS 握手/心跳/协议类别；不展示异常原文、令牌、路径 ID、URL 查询、消息或响应体。恢复在线即清除；换页/退出后不持久，也无远程日志/遥测。阻断时保留诊断及“消息已保留”。要获取故障证据，用户在症状发生时记录屏幕这一行及状态、bundle 版本和操作时间线；未现场记录不能事后追溯。出站发送和历史操作本身的独立错误仍使用原有提示，不宣称本项覆盖所有故障。
- Node 24.14.1 与固定 `HERMES_BASELINE=/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline`（HEAD `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`）：`npm run client:check` 21 基础 + 17 可靠性通过；`npm run check --prefix apps/mobile` 通过；`npm test --prefix apps/mobile` 59 项通过。既有测试覆盖握手/心跳、延迟 HTTP、401/403 阻断、异常 cursor、outbox 持久化/ACK 丢失；新增分类器测试检查敏感字串不出现在诊断。模拟 transport 和 Node 环境不等于 iPhone 真机验收。

## 本轮判定准则

先建真实源码回归，观察 RED 后作最小修复；慢 HTTP/事件/读收据、WS hello/心跳、前后台竞态、原生近似错误分别测试。保留先持久化再发送、同 ID 原文、401/403 阻断、游标异常不自动重置；没有证据不新增 HTTP fallback 或重写协议。候选测试不能证明 iPhone 原故障根因，真机仍需最小时间线：屏幕错误类别/状态/路由、前后台动作及 bundle 版本（不含凭据/正文）。
