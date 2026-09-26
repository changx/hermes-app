# M1 原生键盘与聊天滚动修正

## 当前发布状态

已按 Jamie 授权发布手机测试入口，代码 `ff41a76`（主体修正 `d4d455d`，主控补齐频道表单的单一键盘避让）。主控独立执行57项手机测试、TypeScript及双平台导出通过；表单补齐后再次TypeScript通过，发布后双平台真实bundle打包/下载通过，并检查存在新键盘/滚动实现。Expo启动期间首次公网检查502，随后重试通过。

只重启Expo，开发Gateway、Jamie主实例的PID/启动时间与插件文件哈希均未变化。证据：私有 `workspace/hermes-app/m1-keyboard-verification/release-verification.json`；旧版本 `f1dfa84` 与服务指纹保存在 `before.json`。手机入口仍为 `exps://agent.tuly.space`。

当前结论仅为修正代码发布成功，截图问题是否消失、交互是否跟手仍待iPhone确认；卡片 `t_7eb46948` 保持review。

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
