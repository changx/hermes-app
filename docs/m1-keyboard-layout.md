# M1 原生键盘与聊天滚动修正

## 后续修正决策与隔离候选（未发布、iPhone 待验）

隔离候选复查修正：列表是占 `flex:1` 的普通流布局，dock 是下方普通流兄弟、原生只做 `translateY`；因此列表 viewport 本身已扣除 dock 高度，键盘弹出后的 `KeyboardChatScrollView.offset` 只能扣底部 safe area，不能再扣 dock 高度，否则末条消息仍会落入上移后的整块 dock（含增高输入框和 controls）下方。dock 高度变化时仅已跟随末尾的列表在下一帧重新定位，阅读中不抢锚点，也不改变 `renderScrollComponent` 的引用以免重挂 ScrollView。滚动跟随计算以 `contentHeight + bottomInset - viewport` 为真实末尾，iOS 读取原生 scroll event inset，Android 原生事件不携带其合成 inset 时读取 1.21.9 的 `onContentInsetChange`；保留底部回弹不退出跟随和原生 ScrollView `scrollToEnd` 优先路径。短/长列表、普通/多行输入与 controls 的确定性几何及事件适配器新增回归测试。此为代码推导与单测，不等于真机手势通过。

Jamie 真机反馈：滚到最底后跳回中段，向下拖拽收键盘触发太晚且不跟手。源代码证据：RN 0.86 `FlatList.scrollToEnd` 根据末项近似测量而不是原生实际内容总高度；当前组件在布局、内容改变和拖动/惯性结束时调用它，并把程序动画的 momentum 当作手势。键盘方面当前 dock 仅由 JS 的 willChangeFrame + 布局动画驱动，无法保证逐帧跟手；“触发太晚”具体设备触发链尚未复现，不能冒充已确定根因。

选用 SDK 57 锁定的 `react-native-keyboard-controller@1.21.9`，按 Expo 推荐版本安装对应 Reanimated/Worklets；先检查该**准确版本**导出和 iOS 原生手势实现，不依赖最新文档里该版本不存在的 API。消息保留虚拟化 FlatList；聊天区使用原生手势区域（与 composer `nativeID` 绑定、测量 composer 高度作为手势 offset）和原生驱动的键盘 dock；频道表单保留避让，页眉始终固定。仅一个 inset 所有者，安全区不重复叠加；不再用 JS 键盘帧/定时器近似模拟逐帧手势。列表末尾定位用原生 ScrollView `scrollToEnd` 基于实际内容总高度（可用时含原生 contentInset），备用才用实际测得 content 高度与 viewport 算 offset，不用 FlatList 的末项估算；只有真实拖动更新阅读/跟随状态，弹性回弹及程序动画不算用户滚动，拖动结束不自动校正；前插历史维持阅读锚点。明确保留减少动态效果、前后台恢复与主动发送/回到最新。

验收门槛：确定性生产 helper 测试覆盖末项估算偏差、回弹、程序 momentum、上翻、键盘尺寸变化加末尾消息、历史前插；移动端 TS、单测、双平台 Expo 导出及 Expo 依赖版本检查通过。导出仅证明 bundle，不证明 iPhone 上原生手势、键盘候选栏和前后台体验；真机正反拖拽和长消息跳跃须另行验收。

隔离候选实际实现：1.21.9 包**确实导出** `KeyboardProvider`、`KeyboardGestureArea`、`KeyboardChatScrollView`、`KeyboardStickyView`、`KeyboardAvoidingView` 与 `useKeyboardHandler`；iOS `KeyboardGestureAreaManager.mm` 将 `textInputNativeID`/offset 关联到 `KeyboardOffsetProvider`，其 Swift extender 为匹配输入框增添不可见 accessory 高度，解决拖拽入口在 composer 下方时触发滞后的候选路径（尚待设备确认）。FlatList 的 `renderScrollComponent` 注入 `KeyboardChatScrollView`，采用 `keyboardLiftBehavior="whenAtEnd"`、原生 contentInset 管理及底部 safe-area offset（原提交还重复扣了 dock 高，见上方修正）；整个 controls + composer 放在 `KeyboardStickyView`，避免交互区被键盘遮挡。频道表单独用 controller 的 `KeyboardAvoidingView behavior="height" automaticOffset`；不对聊天列表同时套第二层 KAV。原生键盘事件只在开始/结束时阻止 JS 将键盘驱动的 scroll 误认为读者拖动，不用 JS 帧更新布局。RN 0.86 `RCTScrollView.m` 的 `scrollToEnd` 命令按 `contentSize - bounds + contentInset.bottom` 定位；Android 命令走 native manager。保留 FlatList 虚拟化与恒定可见项锚点；删旧 `KeyboardDock`/`keyboardLayout` 及旧坐标测试。

验证：`npm run check`、`npm test`（57/57）、`npm run export:ios`、`npm run export:android`、`npx expo install --check` 与 `npx expo-doctor`（21/21）均通过；锁定版本 keyboard-controller 1.21.9 / reanimated 4.5.1 / worklets 0.10.1，Expo SDK57 文档注明键盘控制器 1.21.9 Included in Expo Go。尚未在 iPhone 上验证原生组件真实可用、长消息跳跃、短列表正反拖拽、中英九宫格、前后台与频道表单；旧版已发布状态如下属于历史，不代表本候选已部署。新增的网络等待/补齐中故障由主控独立调查，本分支未修改 SDK、transport、outbox、连接生命周期或服务。

## 先前版本的发布状态（历史）

已按 Jamie 授权发布手机测试入口，代码 `ff41a76`（主体修正 `d4d455d`，主控补齐频道表单的单一键盘避让）。主控独立执行57项手机测试、TypeScript及双平台导出通过；表单补齐后再次TypeScript通过，发布后双平台真实bundle打包/下载通过，并检查存在新键盘/滚动实现。Expo启动期间首次公网检查502，随后重试通过。

只重启Expo，开发Gateway、Jamie主实例的PID/启动时间与插件文件哈希均未变化。证据：私有 `workspace/hermes-app/m1-keyboard-verification/release-verification.json`；旧版本 `f1dfa84` 与服务指纹保存在 `before.json`。手机入口仍为 `exps://agent.tuly.space`。

当前结论仅为修正代码发布成功，截图问题是否消失、交互是否跟手仍待iPhone确认。

## 观察与判断

Jamie 提供的截图显示回前台、中文九宫格键盘展开时输入框在屏幕顶部、页眉消失、消息区域异常空白。截图不能证明具体的原生触发序列；本分支没有 iPhone/模拟器复现。代码检查确认旧版将页眉、话题、列表、输入框整体放在 iOS `KeyboardAvoidingView behavior="padding"` 内。RN 0.86.3 的该组件用本地 `onLayout` 的 `frame.y + frame.height` 减屏幕键盘 `screenY`，监听 `keyboardWillShow/Hide`，将差值写到 paddingBottom；它不监听 AppState，也不主动清理回前台的旧事件，且不检查无效/窗口外键盘帧。**坐标混用和旧帧是风险解释，不是截图根因的真机确证。**

## 候选实现

- 页眉/话题栏始终在 `SafeAreaView` 内、键盘避让区域之外。聊天区唯一由 `KeyboardDock` 调整：iOS 测量外层 `measureInWindow`，按屏幕坐标算覆盖高度，已由底部 safe area 扣除，不在同一视图累计 padding；拒绝零坐标、浮动、越界或后台帧。iOS `willShow/willChangeFrame/willHide` 用 RN 的 `Keyboard.scheduleLayoutAnimation` 同步有效布局变化；AppState 入后台清零、回前台只采纳 `Keyboard.isVisible()/metrics()` 的有效帧并重新测量。保持组件和输入焦点，不通过 blur/remount 回避问题。Android 不额外算 JS inset，使用系统窗口 resize；若某宿主关闭 `adjustResize`，仍需设备验证。
- 消息列表明确 `flex:1`，输入框留在紧凑聊天区底部。iOS FlatList 使用原生 `keyboardDismissMode="interactive"` 并允许短列表纵向 bounce；Android 使用原生 `on-drag`（RN 官方明确 Android 的 interactive 等同 none）。不启用 `automaticallyAdjustKeyboardInsets`，否则列表自身 inset 会与唯一的外层 dock 重叠计算。保留 `keyboardShouldPersistTaps="handled"`，不在每个 scroll/tap 调 `Keyboard.dismiss`，发送、链接和复制不需先手动收起键盘。iOS 拖动下移、回拖取消时，键盘帧变化驱动区域几何；这仍是 JS 事件 + 原生布局动画，不是已验证的逐帧 `UIKeyboardLayoutGuide` 绑定。
- 仅末尾新增消息在底部跟随、非键盘运动/可见、非减少动态效果设置时轻度动画滚至末尾；初次/历史恢复、键盘或内容高度调整直接定位。点击「回到最新」可动画；主动发送立即无动画回到底部并保留键盘。阅读中不自动跟随；用户上翻停止跟随，历史前插启用可见项锚点，键盘改变 viewport 时不将纯尺寸变化误认作主动离开底部。RAF、键盘/AppState/无障碍监听和定时器随组件卸载清理。

## 本地验证与真机待验

`apps/mobile` 的 `npm ci --offline`、`npm test`（57/57）、`npm run check`、`npm run export:ios` 和 `npm run export:android` 均通过。确定性测试直接调用生产的键盘坐标/生命周期函数与列表跟随判定，覆盖安全区、九宫格候选栏增高、无效帧、后台清理/回前台、交互式下移与回拖、历史前插及末尾新增判断。Metro 导出只验证 JS 能打包，不等于真实设备上的动画、触控或恢复表现。

部署后需在 iPhone Expo Go 手动观察：①中文九宫格打开后切后台/前台，页眉始终可见、输入框仍在键盘上方、草稿和焦点保留；②中英/九宫格切换、候选栏高度变化与键盘收起时无顶置或跳空；③短列表和长列表向下拖动收键盘、回拖取消，发送后键盘保持、链接/复制无需额外点击；④底部新消息跟随，上翻阅读、新消息与旧历史前插不抢锚点，点击最新返回；⑤启用减少动态效果与 Android on-drag。若真机键盘事件频率不足，当前 JS 驱动只能近似跟手，应另评估原生键盘布局引导实现，不宣称已原生逐帧通过。此版本已发布；真机验收尚未完成，与主实例/后端改动分开。

参考：[React Native ScrollView keyboardDismissMode](https://reactnative.dev/docs/scrollview#keyboarddismissmode)、[Apple 交互式滚动收键盘](https://developer.apple.com/documentation/swiftui/scrolldismisseskeyboardmode/interactively)、[Apple keyboardLayoutGuide](https://developer.apple.com/documentation/uikit/adjusting-your-layout-with-keyboard-layout-guide)。
