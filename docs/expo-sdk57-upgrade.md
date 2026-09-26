# Expo Go SDK 57 兼容修复

## 原因与范围

Jamie 的 iPhone 实际提示：Expo Go 支持 SDK 57.0.0，项目 SDK 54 不兼容。此前依据文档选用 SDK 54 已不适用于这台设备。以实际设备 runtime 为准，不要求用户安装旧版 Expo Go。

仅升级 apps/mobile 的 Expo、React Native 与兼容依赖，保留共享客户端、认证及同步语义。验证通过后更新原 hermes-app-expo 开发服务；不修改 Hermes 核心、profile、模型或凭据。

## 验收

- Expo SDK 57 与其 bundledNativeModules 推荐依赖一致。
- 移动端逻辑测试、TypeScript、iOS/Android Metro 导出通过。
- 原公网入口的双平台 manifest 返回 exposdk:57.0.0，实际 launchAsset 下载成功。
- 真机打开、原生传输及界面交互仍由 Jamie 复测，不用构建成功代替设备验收。

## 依据

- 用户 iPhone Expo Go 错误截图（2026-09-26）。
- https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/
- https://expo.dev/changelog/sdk-57
- npm registry 已确认存在 expo 57.0.25。

## 执行结果

- 代码升级提交：`aa16cca`。Expo 57.0.25、React Native 0.86.3、React 19.2.3；原生模块与开发依赖经 Expo 官方安装器对齐，无业务逻辑改动。
- 6 项移动端测试、TypeScript、`expo install --check` 通过；Expo Doctor 21/21 通过。
- iOS 与 Android Metro JS export 均通过；不是 IPA/APK 或真机运行证明。
- 已在运行目录执行 `npm ci` 并仅重新启动 `hermes-app-expo.service`。开发 Hermes 后端 PID `3674837` 未变。
- 公网双平台 manifest 均 HTTP 200、runtimeVersion=`exposdk:57.0.0`；实际下载 iOS bundle 2,207,944 bytes、Android bundle 2,219,814 bytes，均 HTTP 200。使用 manifest 原始 launchAsset URL，未修改查询参数。
- `/status` 返回 `packager-status:running`；未认证 API 仍 HTTP 401。SDK 57 当前实际只监听 `127.0.0.1:8081`，原专用 IPv4/IPv6 防火墙规则保留。
- npm 安装审计报告 10 项 moderate，无 high；未使用强制审计修复引入额外升级。
- 首次 Python urllib 公网请求被 HTTP 403 拒绝；改用 curl 后双平台 manifest/bundle 均通过。尚不将此视为所有客户端网络栈验证。
- 服务启动尝试安装可选 React Native DevTools，因服务器 Chromium sandbox 配置失败；Metro 持续运行且上述完整公开资源获取通过。没有为此更改系统 sandbox 权限。原生设备 UI 仍待 Jamie 复测。

证据和双平台导出保留：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/dev/expo-sdk57/`，公网结果为 `public-verification.json`。开发服务及运行目录依赖保留以供测试；隔离工作树验收后清理。

## 后续真机账号检查

iPhone 随后报告 Expo Go 已登录 `jamsben`、CLI 未登录。经 Jamie 授权，在 Expo 服务专用 HOME 完成浏览器登录，`expo whoami` 实测为 `jamsben`。移除 `hermes-app-expo.service` 的 `EXPO_OFFLINE=1` 并仅重启 Expo 服务；公网 iOS manifest 已确认 `extra.expoGo.username=jamsben`、runtimeVersion=`exposdk:57.0.0`。无 EAS 签名时 `extra.scopeKey` 仍可为 anonymous，不作为登录失败判据。真机界面仍待复测。

官方依据：https://docs.expo.dev/troubleshooting/expo-go-sign-in-required/ 。认证保留在服务专用 HOME，不写入仓库或开发包。

测试链接仍为 `exps://agent.tuly.space`，原二维码有效。手机从 Expo Go 错误页返回首页后重新打开该链接，检查是否已进入连接页面。
