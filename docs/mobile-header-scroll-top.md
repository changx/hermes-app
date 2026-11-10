# Session 页头部按钮不滚动到顶部（iOS）

## 问题

在手机 Session 页点击右上角的 todo 旗标或「Session options」按钮时，除了执行按钮功能，消息列表还会滚动到顶部。

## 原因

- iOS 26（iPad）和 iOS 27（iPhone）把导航栏区域的点击当作「滚动到顶部」手势，以前只有状态栏有这个手势。
- 系统只在点击位置下方是 `UIControl` 时跳过该手势。React Native 的 `Pressable` 不是 `UIControl`，所以按钮执行 `onPress`，系统同时滚动列表。
- 参考：[react-native#56061](https://github.com/facebook/react-native/issues/56061)、[react-navigation#13226](https://github.com/react-navigation/react-navigation/issues/13226)。

## 修改

- iOS 上，Session 页头部使用 Expo Router 原生栈的 `unstable_headerRightItems`，按钮是原生 `UIBarButtonItem`，系统不对它触发滚动到顶部。实现在 `apps/mobile/src/sessionHeaderItems.ts`。
- Android 没有这个手势，继续使用原来的 `headerRight`（`SessionOptionsButton`）。
- 不使用 `react-native-screens` 的实验组件 `ScrollToTopGuard`：它的原生代码只在 `RNS_GAMMA_ENABLED=1` 时编译，Expo Go 中只有空实现。
- 不关闭消息列表的 `scrollsToTop`：点击状态栏滚动到顶部的系统行为保持不变。点击导航栏空白处滚动到顶部也是 iOS 27 的系统行为，本修改不改变它。

## 验收

- 自动：`tests/session-header-items.test.mjs`、移动端 TypeScript 检查、iOS 和 Android 导出。
- 真机（iPhone）：在长 Session 中上翻离开底部，点击旗标和「…」按钮。列表位置不变；旗标切换 todo；「…」打开 Session options。
- 原生按钮外观由 iOS 绘制，可能与原来的自定义图标略有不同，真机确认。

## 发布记录（2026-11-09）

Jamie 授权（「合并发布」）。纯客户端改动：不安装插件，不重启 Gateway。

- `main` `f030fa6`，已推送到 `origin/main`。移动端测试 245 个：242 通过，2 个失败与发布前的 `main` 相同（`attachment-size`、`local-draft-storage`）；TypeScript 检查通过；iOS 和 Android 导出通过。
- Expo Go：重启 `hermes-app-expo.service`（PID 1991113 → 2369603）。公网 manifest 返回 SDK 58.0.0，launchAsset 返回 HTTP 200。iOS bundle 中 `unstable_headerRightItems` 2 → 3；Android bundle 不含 iOS 分支（1 → 1），新模块文字 `Mark as todo` 2 → 3、`Session options` 3 → 5。
- TestFlight：iOS update `a689f45f-76cf-4e49-93a6-9b2ab8ea0ff0`，runtime `b32a4b59…`（未变），commit `f030fa6`，bundle 13790483 字节，HTTP 200，含 `unstable_headerRightItems`；公网 manifest 返回该 update。
- 回滚：`git revert f030fa6`，重启 Expo；TestFlight `publish.mjs rollback --platform ios --runtime b32a4b59c09764da6bb60618bb3513d46fe43d86 --to 222a0899-d4e6-48e9-9898-c5f22cf3425e`。
- 待验收：iPhone 真机（见上方「验收」）。TestFlight 包在下次冷启动后运行新 update。
