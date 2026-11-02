# Expo Go SDK 58 兼容升级

## 原因与范围

Jamie 的 iPhone 上 Expo Go 已升级到 SDK 58。新版 Expo Go 只支持 SDK 58，SDK 57 项目不能再打开（2026-11-01）。以实际设备 runtime 为准。

只升级 `apps/mobile` 的 Expo、React Native 与兼容依赖，并修复 SDK 58 的 API 变化。共享客户端、认证与同步语义不变；不修改 Hermes 核心、插件、profile、模型或凭据。

## 版本

- Expo 58.0.22、React Native 0.88.1、React 19.3.0。
- 所有 Expo 原生模块与 SDK 58 `bundledNativeModules` 一致，`expo install --check` 通过。
- `@types/react` ~19.3.0、`react-test-renderer` 19.3.0。

## 依赖安装

`expo install --fix` 在旧 lockfile 上报 npm ERESOLVE：`expo-router@58` 的 peer `expo-symbols@^58` 与旧树中的 57 版本冲突。peer 范围本身兼容。处理方法：保留 `expo install` 写入的 SDK 58 版本，删除 `node_modules` 与 `package-lock.json` 后重新 `npm install`。没有使用 `--force` 或 `--legacy-peer-deps`。

## 代码修复

每处修复都保持 SDK 57 的运行行为。

1. `expo-file-system`：SDK 58 中 `File.write()` 和 `FileHandle.readBytes()` 改为异步。现有代码在写入后立即使用文件，所以改用 `writeSync()` 和 `readBytesSync()`（附件、粘贴图片、文件预览、本地草稿存储）。
2. Expo Router：容器 ref 的 `resetRoot` 已删除。连接移除时改用 `navigation.reset(next)`，即官方替代的 `CommonActions.reset` 完整状态。
3. Expo Router：`unstable_settings.initialRouteName` 已弃用，改为 `unstable_settings.anchor`，同一取值。
4. Expo Router：iOS 26 及以上默认使用透明 Liquid Glass 标题栏，内容会进入标题栏下方。根 Stack 设置 `headerTransparent: false`，保持原有不透明标题栏和内容位置。
5. React Native 0.88 严格 TypeScript API：列表 `ListHeaderComponent` / `ListFooterComponent` / `ListEmptyComponent` 不接受 `null`，改为 `undefined`；`BlurTargetView` 的 ref 使用 `ViewInstance`。
6. 测试 mock 同步改为 `writeSync` / `readBytesSync`。

`expo-router/react-navigation` 中使用的 `getDefaultHeaderHeight`、`useHeaderHeight`、`usePreventRemove` 在 SDK 58 仍存在；现有 `usePreventRemove` 回调不重放被阻止的操作，不需要修改。

## 验收

- TypeScript 通过。
- 移动端测试 241 项：240 通过、0 失败、1 跳过（Chromium 表格测试，依赖本机浏览器环境，与升级无关）。
- 共享客户端检查通过；Expo Doctor 20/20 通过。
- iOS 与 Android Metro 导出通过。导出不是 IPA/APK 或真机运行证明。
- 公网 manifest 与 launchAsset 结果见下方发布记录。真机界面由 Jamie 复测。

## 依据

- https://expo.dev/changelog/sdk-58
- https://docs.expo.dev/router/migrate/sdk-57-to-58/
- npm registry：`expo` latest 为 58.0.22。

## 发布记录（2026-11-01）

- 代码提交 `3aa9d7b` 快进合入 `main`。运行目录 `apps/mobile` 执行 `npm ci`（lockfile 已变更），`expo install --check` 通过。
- 只重启 `hermes-app-expo.service`（PID 3345925 → 3320064）。开发 Gateway 与插件不变。
- `/status` 返回 `packager-status:running`；未认证 API 仍为 HTTP 401。
- 公网 iOS / Android manifest 均 HTTP 200，runtime `exposdk:58.0.0`，SDK `58.0.0`，Expo 账号 `jamsben`。
- 各自精确 launchAsset 均 HTTP 200：iOS 12,842,452 bytes，Android 12,933,502 bytes；两个 bundle 都包含 `writeSync` 新代码。
- 测试链接不变：`exps://agent.tuly.space`。真机界面待 Jamie 复测。
