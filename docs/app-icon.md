# 应用图标

状态：默认图标已发布（桌面 v0.1.84）。自选图标为候选实现，分支 `feat/alternate-icons`，未合并、未发布。

Release v0.1.84 (2026-10-13, authorized by Jamie: "合并发布"): icon commit `5c797fa`, release commit `6a564d3`, tag `v0.1.84`. Mac mini workflow run `38511882499`: 199 tests, 150 pass, 0 fail, 49 skipped; `npm audit` 0 vulnerabilities. The downloaded zip passes its `.sha256` check (`88c63b16…68ef`); Info.plist shows 0.1.84, and `Contents/Resources/electron.icns` is byte-identical to `apps/desktop/resources/icon.icns`. Releases kept: v0.1.84 and v0.1.83. Expo: only `hermes-app-expo.service` restarted (PID 210935 → 1699651); the public iOS and Android manifests show SDK 57 and `icon: ./assets/icon.png` (Android also `adaptiveIcon`), and each launchAsset and `icon.png` return HTTP 200. Expo Go does not show the app icon, so the phone icon is not visible until an independent install package exists. No plugin, Gateway or Hermes core change. The Dock icon on Jamie's Mac is not checked yet.

## 已确认需求

- 桌面端和移动端的默认图标都使用 mochi-wings 形象：带一对白色小翅膀的淡紫色团子。翅膀表示信使 Hermes。
- 风格是可爱、抽象的小形象，参考 OpenAI dots 和 Meta Muse 的头像风格。
- 三个形象 Mochi（mochi-wings，默认）、Bubble、Orb 都打包进 App，用户在设置里自选（Jamie 确认，并授权 iOS dev build）。

## 自选图标

设置位置：两端都在 Settings →「This device」→「App icon」，只影响本设备。三个选项依次为 Mochi、Bubble、Orb。

| 平台 | 实现 | 当前选择保存在 | 生效范围 |
| --- | --- | --- | --- |
| iOS / Android | `expo-alternate-app-icons` 8.0.0（config plugin + 原生模块）。iOS 用 `setAlternateIconName`；Android 用 activity alias。 | 系统本身（`getAppIconName()`），App 不另存。 | 主屏幕图标。iOS 每次更换时系统显示提示，App 不能关闭。 |
| macOS | 主进程 `DesktopAppIcon` 调用 Electron `app.dock.setIcon`。 | `userData/app-icon.json`，只接受 `mochi`、`bubble`、`orb`。 | 运行时的 Dock 图标。Finder 和 Launchpad 保持打包的默认图标；App 不修改自己的 bundle。 |

- 移动端用 `requireOptionalNativeModule('ExpoAlternateAppIcons')` 读取原生模块。Expo Go 没有该模块，所以设置项不显示，App 不报错。
- 桌面端只允许 Settings 窗口和主窗口调用 `desktop:get-app-icon`、`desktop:set-app-icon`；Session 视图被拒绝。启动时只有非默认选择才调用 Dock，默认图标由 bundle 提供。
- Android 切换时插件会禁用当前 activity alias、启用新 alias（`DONT_KILL_APP`）。不同启动器的表现（是否关闭 App、主屏幕快捷方式是否保留）未验证。

## 资源

| 文件 | 用途 |
| --- | --- |
| `assets/app-icon/{mochi-wings,bubble,orb}-source.png` | 原图，1254×1254，由 gpt-image-2 生成（openai-codex provider）。 |
| `assets/app-icon/generate.mjs` | 从原图生成下列全部资源。 |
| `apps/mobile/assets/icon.png` | 默认 Expo `icon`（Mochi），1024×1024，不透明。iOS 自动加圆角遮罩。 |
| `apps/mobile/assets/adaptive-{foreground,background}.png` | 默认 Android adaptive icon。 |
| `apps/mobile/assets/app-icons/{bubble,orb}.png` | iOS 备选图标，1024×1024，不透明。 |
| `apps/mobile/assets/app-icons/{bubble,orb}-{foreground,background}.png` | Android 备选 adaptive icon。 |
| `apps/mobile/assets/app-icons/*-thumb.png` | 移动端设置页缩略图，180×180。 |
| `apps/desktop/resources/icon.{png,icns}` | 默认 macOS 图标（Apple 模板：1024 画布、824×824 圆角主体、阴影）；`package.mjs` 使用 `icon.icns`。 |
| `apps/desktop/resources/app-icons/*.png` | 512×512 macOS 模板图，`build.mjs` 复制到 `dist/renderer/app-icons/`，供 Dock 和桌面设置页缩略图使用。 |

Android 前景缩放（`fgScale`）必须让主体全部落在 72dp 可见圆内。脚本测量每张图允许的最大缩放，超过就报错：Mochi 0.70（最大 0.72）、Bubble 0.70（最大 0.74）、Orb 0.68（最大 0.68，翅膀和光晕更宽）。Mochi 背景用四角双线性渐变；Bubble 和 Orb 背景用缩放后原图的镜像延伸加强模糊，因为它们的渐变不能用四角描述。

## 重新生成

sharp 不是仓库依赖。在仓库根目录用任意已安装的 sharp 运行：

```sh
SHARP_MODULE=/path/to/node_modules/sharp node assets/app-icon/generate.mjs
```

默认（Mochi）资源的生成方式未变：重新运行后与 v0.1.84 的文件字节一致。

## iOS dev build

- 已准备：`expo-dev-client`（~57.0.20）和 `apps/mobile/eas.json` 的 `development` profile（`developmentClient: true`，`distribution: internal`）。dev build 包含原生图标模块，并能打开当前 Expo 服务器。
- `npx expo prebuild` 已在临时副本中验证：iOS 资产目录含 `Bubble.appiconset`、`Orb.appiconset` 和 `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES`；Android manifest 含 `.MainActivityBubble`、`.MainActivityOrb` alias。
- 未构建。阻塞项：本机没有 Expo 账号登录或 `EXPO_TOKEN`；Mac mini 没有 Xcode 和签名证书。构建还需要 Apple Developer Program 账号，以及 iPhone 的 UDID 注册（ad hoc 分发）。

## 生效范围

- Expo Go 不显示应用自己的图标，也不能更换图标。手机图标和自选图标只在独立安装包（dev build、TestFlight 或 APK）中生效。
- 桌面自选图标在下一个桌面发布包中生效。

## 建议/待决

- macOS 26 的 Icon Composer `.icon` 格式未提供；packager 会跳过该格式并使用 `.icns`。
