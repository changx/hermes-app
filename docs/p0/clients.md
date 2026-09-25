# P0 CLIENTS：独立桌面 + 手机路线验证

> 隔离、一次性验证，不是生产 App。基线：Hermes `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`；本项目探针位于 `probes/p0/clients/`。未连接现网、未调用模型、未使用个人聊天/密钥、未部署或签名。

## 实测结果

| 项目 | 命令（工作目录） | 结果与证据 |
|---|---|---|
| 原生 Hermes shared SDK | Hermes 基线根目录：`node_modules/.bin/vitest run apps/shared/src/json-rpc-channel.test.ts apps/shared/src/json-rpc-gateway-replay.test.ts apps/shared/src/json-rpc-gateway-connect.test.ts --reporter=verbose` | 3 文件 / 23 测试通过，涵盖 RPC 错误、心跳、服务器请求、断线回放、竞态、epoch；[`evidence-sdk-tests.txt`](../../probes/p0/clients/evidence-sdk-tests.txt)。是 fake WebSocket 单测，**不等于真实远程多端同步**。 |
| 浏览器沙箱可用 SDK | 在 `probes/p0/clients`：`npm ci --no-audit --no-fund && npm run build` | esbuild browser/ESM，SDK `json-rpc-gateway.ts` 与 `json-rpc-channel.ts` 实际进入 42,603 字节 renderer.js，metafile 检查 0 个 Electron/Node/desktop 输入且无 external import；[`evidence-bundle.txt`](../../probes/p0/clients/evidence-bundle.txt)、本机 `dist/bundle-evidence.json`。UI 标注合成数据，保持 `idle`，未拨号。 |
| 独立 Linux 桌面本地包 | `node package-desktop.mjs`；`dpkg-deb --info hermes-p0-synthetic-probe_0.0.1_amd64.deb`；`dpkg-deb -x hermes-p0-synthetic-probe_0.0.1_amd64.deb .electron-stage/extracted`；`HERMES_P0_SELFTEST=1 ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a timeout 35 .electron-stage/extracted/opt/hermes-p0-probe/electron` | 本地 .deb（88,017,566 字节）生成、解包启动并读取真实 renderer DOM，自检 `P0_DESKTOP_SELFTEST_OK`，退出码 0；[`evidence-deb-info.txt`](../../probes/p0/clients/evidence-deb-info.txt)、[`evidence-deb-extracted-run.txt`](../../probes/p0/clients/evidence-deb-extracted-run.txt)。Xvfb 下有非致命 systemd/dbus 错误。**未系统安装、未验证生产沙箱/桌面集成、未签名**；测试显式关闭 Electron sandbox。 |
| 手机原生容器源码 | `npm run mobile:add && npm run mobile:sync` | Capacitor 8.5.2 生成 `android/` 项目（Activity/Manifest/Gradle），同一 renderer 复制进 Android assets 且内容按字节相同；[`evidence-mobile-add.txt`](../../probes/p0/clients/evidence-mobile-add.txt)、[`evidence-mobile-sync.txt`](../../probes/p0/clients/evidence-mobile-sync.txt)。这**不是 APK、更不是 Web/PWA 可替代手机 App 的验收**。 |
| 手机编译 | `./android/gradlew --offline assembleDebug` | 失败：无 `JAVA_HOME`/`java`；亦未发现 Android SDK、adb/模拟器。未安装大工具链或签名/设备配置；[`evidence-android-build.txt`](../../probes/p0/clients/evidence-android-build.txt)。不能声称 APK 可安装或手机 UI、键盘、推送可用。 |

锁文件 [`probes/p0/clients/package-lock.json`](../../probes/p0/clients/package-lock.json) 固定 Electron 40.10.2、esbuild 0.28.1 与 Capacitor 8.5.2。`dist/`、`node_modules/`、`.deb`、Gradle 输出不提交；本机产物仍保留于 `probes/p0/clients/dist/`、`probes/p0/clients/hermes-p0-synthetic-probe_0.0.1_amd64.deb`、`probes/p0/clients/android/`。源码引用基线绝对路径并核对 HEAD，移机须提供同一基线并调整 `build.mjs`，不是独立可发布 SDK npm 包。

## 复用决定与边界

**推荐一条最短路径：桌面从现有 Electron/React shell 派生独立入口；手机先以 Capacitor Android 容器承接共享 React/TypeScript renderer；共用 `apps/shared` 的 JSON-RPC、类型及消息展示/状态中不依赖 Electron 的部分。** 已证明 shared SDK 可在浏览器/原生 WebView 容器所用 bundle 中构建，且 Electron 壳能实际打包运行；只证明 Android 容器源码生成，**未证明 Android 包可构建或原生能力通过**。保持 Hermes 作为 Channel/Thread/历史与同步权威；Discord 只供交互设计参考，不引入 Discord 协议/服务。若 Android 真机验证发现 WebView 长列表、输入法/安全区或后台生命周期不达标，则改用原生 UI（保留 TypeScript/协议契约），不强行共享整页。

- 可直接复用：`apps/shared/src/json-rpc-{channel,gateway}.ts`、`gateway-events.ts`、`websocket-url.ts` 等，Desktop 的非原生消息投影和 React 组件须逐一依赖审计；现有桌面 `src/sdk/index.ts` 与 `src/api/*` 大量访问 `window.hermesDesktop`，**不能直接整包搬进手机**。桌面正式包宜复用原有 Electron 打包链而非提升本探针的手工 .deb。
- 平台桥必须分别实现与验证：远端连接认证/安全凭据（不可把令牌硬编码在包内）、Electron preload 对应的移动能力、文件/相册选择与上传及权限、通知点击深链/系统推送与 token 注册、前后台/被系统杀死后恢复同步、离线缓存身份隔离、输入法与 safe area、长历史性能、系统签名/安装/升级。Android 生成的 Manifest 仅声明 INTERNET；没有真实推送插件/凭据/设备端到端验收。iOS 因缺 macOS/Xcode 完全未测。
- SDK 回放是**进程内短暂补帧机制**，不是离线持久消息日志。`json-rpc-gateway.ts` 对 epoch 改变清空水位，对 `session.events.since` 失败容忍，当前代码未将 `truncated` 直接转为持久快照重拉；不能凭 23 个 SDK 单测承诺长离线、跨重启、幂等、审批跨端竞态或最后客户端离线执行。这些是 Hermes 服务端 P1 数据/运行契约，需与另外 P0 lane 的结果合并。
- 法务：基线 `LICENSE` 为 MIT，独立产品若复制 shared/Desktop 源码应保留 Nous Research 版权与许可文本（探针 .deb 内含 `LICENSE.hermes-agent`）。Electron/Chromium/Capacitor 及其他依赖另有第三方许可证与分发告知，正式分发前生成并审查完整归属清单、名称/商标许可与平台商店条款；MIT 不自动授予商标使用权。本探针沿用 Electron runtime，仅本地构建，没有公开发布。

**下一门槛**：在隔离且配好 JDK/Android SDK 的构建机执行 `npm ci && npm run build && npm run mobile:sync && ./android/gradlew assembleDebug`，生成并实机安装 APK，测试键盘/长列表/附件/通知点击/退后台与重启；对 iOS 在有授权的 macOS/Xcode 环境另建容器测试。使用真实 Hermes 连接与权限前先定服务端协议、认证与可恢复同步契约。没有这些证据前，R01/A01/A12 不达标。
