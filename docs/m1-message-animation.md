# 消息滚动动画修正

## 范围与已有证据（改代码前）

Jamie 在 iPhone 反馈新消息仍是突然跳入；本机没有 iPhone，不能用构建或模拟事件宣称真机动画已通过。基线 `b6087ff` 的 `ChatTimeline` 对计划跟随与显式 `followLatest` 均以 `Keyboard.isVisible()` 禁止动画，导致键盘静止打开时发送、点「回到最新」和末尾新增都只走非动画。`scheduleFollow(false)` 可以覆盖同帧排队的 append 动画；每次 `onContentSizeChange` 都清空 `appended.current`，后续尺寸/布局回调会压过先前的动画。保持已有原生 `scrollToEnd`、键盘控制器 inset、短列表自然高度、手势与阅读位置策略。

仅调整手机 `ChatTimeline` 的跟随调度、`App` 主动发送的跟随调用与对应生产回调测试，不改消息淡入、网络、后端、其他 UI、依赖或发布服务。静止打开键盘允许原生滚动动画；键盘原生移动/交互期间不发独立的跟随命令，必要时在移动结束后处理仍有效的末尾跟随；初次定位、历史/恢复位置保持无动画，阅读模式不跟随。连续内容测量或 dock 布局不能把已排队的末尾动画改成瞬移；保留减少动态效果设置。

## 验证计划

在真实生产回调上用 TS transpile + VM 的 RN/React mock 执行：键盘静止打开的显式跟随和新增；同帧追加、多次内容测量及 dock 变化；键盘移动期间延后、移动结束、阅读模式中断；初始/恢复非动画、减少动态效果与精确原生末尾。尽可能先记录 RED 再修复。运行离线依赖安装、共享 SDK 构建（按需）、手机全测试与 TS，以及 iOS/Android 双平台 Metro 导出，产物放私有路径，不入库。真机键盘手势与动画手感仍待 Jamie 验收。

## 结果

生产回调测试先 RED：基线上键盘静止打开时显式最新返回 `animated:false`，同帧追加/内容测量也被覆盖成 `false`，移动结束后待处理追加没有发出滚动；修复后 7 项新增回调测试均 GREEN。测试执行 `ChatTimeline` 的真实 `onLayout`、`onContentSizeChange`、dock、键盘 handler、onScroll/手势以及 `App` 实际发送回调，模拟 React/RN 调度；涵盖静态键盘、interactive 开始/结束、同帧/后续高度事件、阅读模式取消、主动发送、恢复/初次无动画和减少动态效果。锁定 keyboard-controller 1.21.9 的 helper 与既有短列表回归测试仍保持原状。

`npm ci --offline` 手机与仓库根目录均通过；初次全手机测试因新 worktree 缺少共享 SDK `dist/index.js` 失败，按相同源码运行 `npm run build --prefix packages/client` 后全手机测试 **72/72**、`npm run check`、iOS 和 Android 离线 Metro 导出、`git diff --check` 均通过。仓库根目录 `client:check` 因未传 `HERMES_BASELINE` 自行退出，和本次手机范围无关。双平台导出 metadata 与实际 JS bundle 文件核对存在，随后删除私有导出目录以免留下大体积临时产物；保留日志在 `/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/m1-message-animation-verification/`：`mobile-tests.log`、`mobile-ts.log`、`ios-export.log`、`android-export.log`。无新增依赖、无部署；没有 iPhone，原生每帧动画、键盘手势/反转与视觉手感仍待 Jamie 真机验收。
