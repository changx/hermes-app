# 运行状态与输入区共享毛玻璃面板

## 范围

将 `Agent is running` 从输入区上方的独立布局移入 `KeyboardStickyView` 内唯一的 composer surface。运行状态、附件菜单/预览和输入行现在共同位于一个 `BlurView` 中并一起随键盘移动；“回到最新”透明行仍位于该 surface 外。状态语义、动画和 receipt 判断未改动。

面板使用 `expo-blur` 57.0.3：iOS 使用 `systemMaterialLight`；Android 将消息列表设为 `BlurTargetView`，在 SDK 31+ 使用 `dimezisBlurViewSdk31Plus` 原生模糊，旧 Android 使用该库的半透明 fallback，避免旧版设备的 RenderScript 性能成本。外层保留唯一上沿阴影，附件和输入子区域改为透明，不新增子级 blur/shadow。

## 本地验证

在隔离 worktree `jamie/running-indicator-blur` 完成：

- 目标组件/键盘测试：62/62 通过。
- 全量 mobile tests：301/301 通过。
- `npm run check`：TypeScript 通过。
- `npm run export:ios`：通过，1697 modules。
- `npm run export:android`：通过，1785 modules。
- `git diff --check`：通过。

测试替身确认 indicator、附件区和输入行同属唯一 blur/shadow surface，latest row 在其外，并保留既有键盘几何契约；Metro 双平台导出仅证明可打包，不证明 UIKit/Android 的真实视觉与手势。

## 待真机验收

尚未在真实 iPhone/Android 上验收。发布前仍需检查：键盘开合与中文键盘、indicator 出现/消失导致的 dock 高度变化、附件菜单、多行输入、safe area、内容滚到面板后方时的模糊效果，以及 Android 12+ 原生模糊和旧 Android fallback。此分支未合并、未更新 Expo 入口、未重启或发布服务。
