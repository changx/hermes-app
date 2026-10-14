# 应用图标

状态：已发布（桌面 v0.1.84）。

Release v0.1.84 (2026-10-13, authorized by Jamie: "合并发布"): icon commit `5c797fa`, release commit `6a564d3`, tag `v0.1.84`. Mac mini workflow run `38511882499`: 199 tests, 150 pass, 0 fail, 49 skipped; `npm audit` 0 vulnerabilities. The downloaded zip passes its `.sha256` check (`88c63b16…68ef`); Info.plist shows 0.1.84, and `Contents/Resources/electron.icns` is byte-identical to `apps/desktop/resources/icon.icns`. Releases kept: v0.1.84 and v0.1.83. Expo: only `hermes-app-expo.service` restarted (PID 210935 → 1699651); the public iOS and Android manifests show SDK 57 and `icon: ./assets/icon.png` (Android also `adaptiveIcon`), and each launchAsset and `icon.png` return HTTP 200. Expo Go does not show the app icon, so the phone icon is not visible until an independent install package exists. No plugin, Gateway or Hermes core change. The Dock icon on Jamie's Mac is not checked yet.

## 已确认需求

- 桌面端和移动端的默认图标都使用 mochi-wings 形象：带一对白色小翅膀的淡紫色团子。翅膀表示信使 Hermes。
- 风格是可爱、抽象的小形象，参考 OpenAI dots 和 Meta Muse 的头像风格。

## 资源

| 文件 | 用途 |
| --- | --- |
| `assets/app-icon/mochi-wings-source.png` | 原图，1254×1254，由 gpt-image-2 生成（openai-codex provider）。 |
| `assets/app-icon/generate.mjs` | 从原图生成下列资源。 |
| `apps/mobile/assets/icon.png` | Expo `icon`，1024×1024，不透明。iOS 自动加圆角遮罩。 |
| `apps/mobile/assets/adaptive-foreground.png` | Android adaptive icon 前景，原图缩到 70%，边缘羽化。 |
| `apps/mobile/assets/adaptive-background.png` | Android adaptive icon 背景，用原图四角颜色做双线性渐变。 |
| `apps/desktop/resources/icon.png` | macOS 图标母版，1024 画布，按 Apple 模板放 824×824 圆角主体并加阴影。 |
| `apps/desktop/resources/icon.icns` | `package.mjs` 的 `icon`，包含 16 到 1024 的 PNG 尺寸。 |

Android 前景缩到 70%，因为测量显示：缩放 80% 时，约 2% 的主体像素（翅膀尖）落在圆形启动器遮罩外；缩放 70% 时为 0%。

## 重新生成

sharp 不是仓库依赖。用任意已安装的 sharp 运行：

```sh
SHARP_MODULE=/path/to/node_modules/sharp node assets/app-icon/generate.mjs assets/app-icon/mochi-wings-source.png .
```

## 生效范围

- Expo Go 不显示应用自己的图标。手机图标只在独立安装包（dev build、TestFlight 或 APK）中生效。
- 桌面图标在下一个桌面发布包中生效。

## 建议/待决

- 自选图标：mochi-wings、bubble、orb 三个形象作为用户可选图标，可用 `expo-alternate-app-icons`（需要原生构建）和 Electron `app.dock.setIcon`。未实现。
- macOS 26 的 Icon Composer `.icon` 格式未提供；packager 会跳过该格式并使用 `.icns`。
