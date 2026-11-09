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
