# P2：首个 Expo 移动开发版本

<!-- status-refresh-2026-10-06 -->
> **历史文档说明（2026-10-06）：** 本文记录 P2 首版当时的状态。下文“真实模型联调未通过”和 `gpt-6-luna` 主模型已过时：真实模型联调已经通过，当前开发 profile 主模型为 `anthropic / claude-opus-5-5`。当前状态见 [开发环境](dev-environment.md)。

## 授权与范围

Jamie 已明确授权继续开发并启动 Expo 移动端测试，提供手机可打开的测试链接；允许测试用隔离后端真实 Codex 联调。项目 AGENTS.md 授权条款更新虽已获聊天许可，但工具层文件审批超时，尚未写入，不通过其他路径绕过。

本轮交付 `apps/mobile`：React Native 原生界面、连接配置、Channel/Thread 创建和选择、原始历史分页、发送与收据、失败重试、同步、停止和待处理交互。复用 `packages/client`，不重做协议或改 Hermes 核心。使用 Expo Go 提前做手机验证；不是商店发布、独立签名安装包或 P2/P3 全部完成。

## 验收目标

- 原生连接使用 HTTPS 与带 Authorization header 的 WebSocket；服务地址默认 `https://agent.tuly.space`，凭据由使用者输入并保存至系统安全存储，不写进 JS bundle、URL、仓库或聊天。
- 同一次不确定发送的重试保持原 client_message_id、Thread 和正文；新发送必须新 ID。不自动重跑状态 unknown 的执行。
- 明确显示连接、请求 loading、queued/running/completed/failed 等状态，客户端离线不停止服务端执行。
- 实际运行 TypeScript、移动端逻辑测试、iOS/Android Metro JS 构建，以及真实开发 API 的认证/HTTP/WS/Codex 消息联调。
- 实际读取公开 Expo manifest 和 bundle；链接交付后，由手机验证 Expo Go SDK 兼容性、键盘、安全区、后台恢复和 WebSocket 原生传输。

## 不在本轮完成声明内

桌面 UI、APNs/FCM、商店发布、全量附件交互、离线持久消息缓存，以及真实 Codex native compaction 与轮转组合的专项验收。不得将 P1 本地摘要压缩测试或 Metro JS 构建等同于真实手机验收。

## 跟踪

- 隔离工作树 `/opt/projects/jamie/_worktrees/hermes-app/p2-expo-first`。
- 主控负责现有后端联调、入口、独立验收和集成；不修改其他 profile，不因客户端开发升级/重启 Hermes 核心。
- 主控已核验并集成本地提交 `5cb1128` 与 `de592a4`；临时 UI 工作树已移除，分支保留。

## 实际交付与验证（2026-09-26）

测试链接：`exps://agent.tuly.space`。当前为 SDK 58，匹配 Jamie 的 iPhone 实际 Expo Go SDK 58 runtime；首次交付 SDK 54 被真机拒绝，旧文档的 App Store 版本说明不能替代实际设备证据。升级与复验见 [SDK 57 兼容修复](expo-sdk57-upgrade.md) 和 [SDK 58 兼容升级](expo-sdk58-upgrade.md)。普通 HTTPS 根页面是 Expo manifest 入口，不是 Web 聊天界面。

手机首次打开填默认服务器地址及开发 profile `.env` 的 `HERMES_APP_TOKEN`；它与 OpenAI OAuth 登录不同。令牌不得贴到群聊或放入链接。更换服务器须重新输入对应令牌，已新增跨源不复用凭据的回归测试。

首次 SDK 54 交付的历史检查（以下版本、依赖审计与 OAuth 阻塞为当时结果；当前 SDK 升级结果见上述修复记录）：

- 移动端 6 项 Node 测试通过；TypeScript check 与 Expo dependency check 通过。
- Android、iOS Metro export 均完成；这不是 APK/IPA 或手机运行证明。
- 公网两平台 manifest 均 HTTP 200，runtimeVersion 为 `exposdk:54.0.0`；manifest 中 launchAsset 均指向 HTTPS 同域。
- 实际下载两平台公开 bundle：iOS 2,784,291 bytes，Android 2,795,726 bytes。
- 应用实际 `nativeTransport` + `HermesClient` 在 Node WS shim 下完成公网 capabilities、快照/增量与认证 WS hello；不是原生手机网络栈测试。
- 未认证 HTTP/WS 均拒绝，双 WS 收到同一事件，同一个 client_message_id 返回相同收据。
- 真实模型联调未通过：运行时缺少 Codex 凭据；正在重新进行独立 OAuth，模型配置已按 Jamie 指定改为 `gpt-6-luna`。未把 API 成功等同模型成功。
- 主控补上无选项的澄清回答输入；完整交互仍待手机验证。
- npm audit：12 项（10 moderate、2 high，image-size/postcss）；不盲目升级到不兼容 iOS Expo Go 的新 SDK。此开发包不作为正式生产依赖安全验收。

证据和合成联调数据保留于 `/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/dev/`；二维码交付文件：`/home/hermes/.hermes/profiles/jamie/workspace/deliveries/hermes-app-expo-qr.png`。

## 运行、网络限制与回退

- `hermes-app-expo.service`：工作目录 `/opt/projects/jamie/hermes-app/apps/mobile`，Expo 57，`EXPO_PACKAGER_PROXY_URL=https://agent.tuly.space`。`--no-dev --minify` + CI，无远程调试或自动热更新；修改后重启此服务可重新加载。
- `hermes-app-expo-bridge.socket/service`：`172.31.0.1:18081` → `127.0.0.1:8081`。
- Traefik 配置 `/opt/projects/jamie/ovh01-ingress/dynamic/hermes-app-expo.yaml` 仅开放 manifest、status、bundle 与 assets；`/v1` 仍由原插件处理。`/open`、inspector 不会转发 Metro（实测返回原 API 401）。
- Expo 54 的 `--localhost` 只改变广告地址，实测仍监听所有接口。因此在 IPv4/IPv6 INPUT 中为 8081 加了仅允许 loopback 的专用规则，comment=`hermes-app-expo-dev`；服务 ExecStartPre 幂等确保规则先存在再启动。实测公网源地址直连 8081 被拒绝，HTTPS `/status` 正常。不改其他端口规则。
- 用户级 systemd 的 IPAddressDeny 无 root 支持，已移除无效配置；采用可验证的 iptables 限制。
- 保留 Expo 服务及专用 bridge 供 Jamie 测试、主仓库 app node_modules 供构建、私有 Expo HOME 和 bundle 证据。临时工作树/重复依赖已经由 git worktree remove 清理。
- 停用时只停 `hermes-app-expo.service` 与 `hermes-app-expo-bridge.socket/service`，移除专用 Traefik 文件；确认服务禁用后可按 exact comment/port/source 删除两条专用防火墙规则。不要动开发 Gateway 或共享入口。

## 手机验收进展与清单

Jamie 已在本线程确认 SDK 57 界面可打开、令牌连接成功、基本通讯正常。完整后台/断网/冷启动/双端与交互验收仍未完成。当前真实 Codex 登录与 Luna 通讯已恢复，上文首次 SDK54 的 OAuth 错误仅为历史记录。

1. Expo Go 扫码加载，界面无红屏，安全区与键盘不遮挡发送框。
2. 填令牌连接，打开“手机开发测试”频道和测试话题；创建自己的新话题。
3. OAuth 恢复后发送一条消息，观察接收/执行/完成和真实 Luna 回复。
4. 切后台再回来、断网重连、关闭 Expo Go 再打开，验证历史和收据准确。
5. 同时开启另一设备，确认新消息、停止和待回答交互一致；任何异常保留可复现步骤，不把未完成任务自动重发。

