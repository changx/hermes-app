# P0 手机框架收口：Expo/React Native + Electron

**唯一推荐：桌面沿用 Electron/React；手机用 Expo/React Native 原生界面。** 这是 P1/P2 的技术路线建议，不是产品已交付或手机交互已验收。最终仍须分别交付可安装的桌面与手机 App；Web/PWA 或本探针的 JS 文件均不能替代。固定只读 Hermes 基线 `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`，App 探针见 [`probes/p0/close-mobile`](../../probes/p0/close-mobile/)。未修改 Hermes 核心、未部署、未用账号或真实数据。

## 对照与决策依据

| 路线 | 复用与交互收益 | 成本/边界 |
| --- | --- | --- |
| **Expo/RN 手机 + Electron 桌面（选）** | 已有 Electron/React 桌面与 `apps/shared` TypeScript SDK；[既有 P0](clients.md) 曾通过 23 个 SDK 单测与独立 Linux .deb 合成自检。本次 Metro **Android 平台**直接编译真实 SDK 的 `JsonRpcRequestChannel` 和 `JsonRpcGatewayClient` 到 RN `View/Text` 入口，未依赖 Electron/Node/桌面源码。Expo 官方将 Metro JS/资源导出与原生 runtime 编译明确分开。[1][2] | RN 需要重写手机视图而非复制桌面 DOM；平台桥、原生依赖、生命周期、持久同步需另做；**成功导出 JS 不等于 APK 或体验好**。本机缺 Java/Android SDK 与 iOS/Xcode，不能设备验收。[6] |
| **Flutter 手机 + Flutter 桌面（不选）** | Flutter 官方支持跨 Android/iOS/桌面平台及原生平台服务集成，可为不同尺寸/输入设备设计自适应 UI；若团队完全转 Dart，一套 widget 体系可复用。[3][4][7] | 现有 Electron/React UI 与 TypeScript SDK 无法直接在 Dart Flutter 中调用；需重写客户端通信/状态/桌面 UI，或引入双运行时桥，增加最短可靠路径的维护面。并非判定 Flutter 性能或体验较差；未安装/实测 Flutter。 |

[既有 Capacitor 探针](clients.md) 已证明 WebView Android 工程源码生成，但没有 APK/设备证据；本次**不重复**打包。由于手机核心是长聊天列表、连续滚动、键盘输入、附件和系统后台/通知，先选择可独立设计原生移动视图的 RN，而不是把已有整页 Web renderer 当作最终手机 UI；是否实际达到目标由 P2 真机门槛裁决，不能由框架名保证。Electron renderer 必须保持 Node 集成关闭、上下文隔离和沙箱，preload 限权；既有诊断包曾显式关闭 sandbox，不能视为生产安全验收。[5]

## 本次实测（不是 APK/真机）

在 `probes/p0/close-mobile/` 执行 `bash run.sh`（检查基线/磁盘 → 私有路径 `npm ci` → Android JS 导出 → 内存协议测试 → 产物核验）；脚本中的原始命令、超时和可覆盖的基线路径见 [README](../../probes/p0/close-mobile/README.md)。包只装入私有路径，仓库 `node_modules` 是未提交的本地链接，不重跑客户端旧探针。

`expo@54.0.37`、`react-native@0.81.5`：Metro Android JS export **通过（本次运行 562 modules；2,716,302 字节）**；[`export-android-js.log`](../../probes/p0/close-mobile/export-android-js.log) 与 [`results.json`](../../probes/p0/close-mobile/results.json) 含产物 SHA-256。`--no-bytecode` 仅为可审计的 **JS 诊断导出**，Expo 警告不可作为正式原生发布产物；输出 `dist/` 不提交。bundle 含真实 SDK 两类与 RN `View/Text`，当前探针只创建实例，不拨号/渲染设备。两份 SDK 入口的运行时 import 均为相对模块，且不含 Node/Electron/desktop 导入；检查脚本只审计**所选入口与其当前源码**，不是整个 Hermes shared 或 RN runtime 的安全证明。`test:protocol` 使用实际 `json-rpc-channel.ts` 通过 5 个合成内存断言：请求应答、event、未处理服务端请求、typed error、断线待决请求；[`protocol-test.log`](../../probes/p0/close-mobile/protocol-test.log)。**没有测试插件协议或真实服务端。**

两处真实移植陷阱及修正均保留在 `metro.config.cjs`：scoped npm 安装使 `expo-asset` 等在 Expo 嵌套 `node_modules`，禁用层级查找会导致 Metro 找不到它；Hermes TS ESM 源码使用相对 `.js` specifier，Metro 不自动映射 `.ts`，需只对基线 shared 源文件做精确映射。本探针映射不是可发布的独立 SDK 包。

## 模块边界与 P1/P2 闸门

- **共享纯 TS**：挑选 `apps/shared/src/json-rpc-channel.ts`、`json-rpc-gateway.ts` 与类型/事件归并作为可移植起点；任何引入都做 RN Metro 依赖图和运行时验收。不得把 `apps/desktop/src/sdk`、`src/api` 的 `window.hermesDesktop`、Electron preload、Node 文件能力打进手机。桌面从现有 React/Electron 入口派生，手机 UI 用 RN 原生列表、输入与导航；不要承诺可直接共享 DOM 组件。
- **P1 服务端契约先定**：当前 shared GatewayClient 针对 TUI JSON-RPC `gateway.ready`、`session.events.since` 等；[插件验证](plugin-transport.md) 的新 HTTP/WS 是独立入口、不能声称直接 drop-in。通过**正式插件**提供版本化、身份绑定的 HTTP/WS 或明确复用原生 RPC 的兼容面，再做最薄 client adapter；不要改核心 `_methods`。明确 URL/认证（短期票据、TLS、作用域和过期，令牌不得硬编码/日志外泄）、Thread/消息稳定 ID、接收幂等键、分页快照 + 持久增量游标/epoch/截断重拉、已读、附件授权和配额、审批竞态、任务接受/完成/中断及重启恢复。SDK 原有进程内 replay 不是持久同步；服务端是权威，客户端缓存不新建第二套历史。[插件汇总](plugin-summary.md) 已列未完成项。
- **P2 移动/桌面适配器**：凭据安全存储、连接与 AppState 重连、离线草稿/身份隔离缓存、文件/相册权限和上传、通知注册/点击深链、更新与签名分别实现；RN WebSocket/URL/TextDecoder、审批回包及认证跨 Android/iOS 真机验证。不要默认后台常驻 WebSocket；推送只作提醒，启动后向服务端拉取权威历史。
- **P2 设备闸门**：有本地 JDK/Android SDK 的受控构建机执行 `npm ci`、`npx expo run:android --device`（或生成并实机安装 debug APK）；有 macOS/Xcode 时 iOS 单独验证。记录版本/设备/网络：中文输入法组合与键盘安全区、长历史分页/列表帧率与内存、附件/权限、前后台/系统杀进程/重启补齐、通知点击、断网重试/乱序和两端审批。P1 合同未稳定前只用合成数据；通过后才可声称 A01/A05/A12。真机体验不达标须调整原生 UI/渲染策略，再依据数据重审框架，不强迫复用整页。官方 Expo 本地编译要求 Android SDK 或 Xcode；本轮没有装工具链、没有 APK、没有 iOS 构建。[6]

成本/资源：私有 scoped 依赖约 `295M`，本轮结束约 `147G` 可用；只保留复现所需依赖与忽略的 `dist/` JS 产物。未进行 Flutter 基准测试、云构建、账号登录、推送服务调用或签名。

## Sources

[1] https://docs.expo.dev/more/expo-cli
[2] https://docs.expo.dev/guides/customizing-metro
[3] https://docs.flutter.dev/resources/architectural-overview
[4] https://docs.flutter.dev/ui/adaptive-responsive
[5] https://www.electronjs.org/docs/latest/tutorial/security
[6] https://docs.expo.dev/guides/local-app-development.md
[7] https://docs.flutter.dev/platform-integration
