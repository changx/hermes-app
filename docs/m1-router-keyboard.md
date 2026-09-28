# Expo Router 聊天键盘回归

## 反馈与范围

Jamie 反馈迁移 Expo Router 后：输入区落入底部安全区，打开中文键盘后输入区被挡，消息区不能协调移动，拖动消息区不能收键盘。续接 `default / t_7eb46948`，关联 Router 卡 `t_49b0a1d8`。只修客户端布局与已有键盘库接入；保留原生 Stack、消息跟随/阅读锚点、字体、通信和后端。

## 证据与修正决定

- `2c7dce2` 移除了旧应用根部 SafeAreaView。新的频道、设置、连接、查看页均自行保留 bottom/left/right，但 `src/app/threads/[threadId].tsx` 直接返回 ThreadScreen，没有安全区。ChatTimeline 的 scroll offset 与 sticky opened offset 仍为 `insets.bottom`，依赖其外层已扣除底部安全区；迁移打破了这个布局契约。恢复聊天路由的 bottom/left/right SafeAreaView，不重复添加 native Stack 已占用的顶部导航空间。
- 当前 RN 0.86.3 的 `RCTScrollViewComponentView.betterHitTest` 在内容子视图未命中时返回包装视图，而非内部 UIScrollView。keyboard-controller 1.21.9 的 ClippingScrollViewDecorator 已内置 `applyWorkaroundForContentInsetHitTestBug`，用于让这种留白/inset 区的触摸返回内部 ScrollView。只在聊天滚动组件启用现有兼容项，保留 iOS interactive + 短列表 bounce、Android on-drag，不在 JS onScroll 强制 dismiss。
- 该兼容项使用依赖内的原生运行时 hit-test 修正，不修改 Hermes/RN 源码、不新增依赖或自制手势。源码与官方描述支持此缺陷路径，但没有在 Jamie 的 iPhone 上抓取触摸事件，不能把它称为全部手势故障的确证根因。
- 列表和输入区仍由同一 KeyboardProvider 驱动：列表只添加 keyboard height - bottom inset，dock 同量上移；不再扣 composer 高度，不新增 KeyboardAvoidingView 或系统自动键盘 inset，短列表不使用 flexGrow 撑高内容。

## 返回后其他页面高度异常

Jamie 补充频道页截图，并确认发生路径为“从键盘打开的聊天页返回后出现”。截图中频道列表提前截断，下方有大块空白；不能只用缺失的聊天安全区解释。频道、连接和设置的 KeyboardAvoidingView 目前无条件启用，原生 Stack 保留隐藏页面，它们会接收其他页面的全局键盘动画。当前库 height 模式在内部 isClosed=false 时返回固定 height/flex:0；该状态与 JS keyboardDidHide 通知属于不同事件通路，因此不能仅依赖它在原生导航/恢复后自动正确收尾。没有真机事件追踪，具体漏失/乱序步骤仍未确证。

首轮尝试（Jamie 真机反馈失败，以下结论已被下一节修正）：这些表单页统一通过一个薄组件使用已有 `useIsFocused()` 与 keyboard-controller `useKeyboardState(state => state.isVisible)` 控制 enabled。隐藏页面不参与高度避让，keyboardDidHide 后强制撤销固定高度；仍由库负责展开/收起动画，保留同一个容器和子树，不重挂表单、不加延时、不关闭导航动画。聊天继续使用原来的 native sticky/scroll 方案，查看页无表单高度避让。

## 半高问题返工

- `40a215a` 真机仍失败。已安装 controller 1.21.9 的 `KeyboardAvoidingView` height 模式关闭/禁用时返回 `{}`；Reanimated [官方契约](https://docs.swmansion.com/react-native-reanimated/docs/core/useAnimatedStyle/)明确说明移除动画属性不会撤销已经应用的原生值。单纯 `enabled=false` 不保证清除 `height/flex:0`。这是确定的代码缺口；没有 iPhone 事件追踪，仍不能宣称已穷尽所有原生导航原因。
- 旧测试把每次 animatedStyle 当作完整样式替换，遗漏了原生增量写入语义。先增强替身、证明旧代码失败，再执行实际 RN KAV 源码检查恢复。
- 普通表单页改用 RN 自带 KAV 的 padding 模式，保持外层 `flex:1`，禁用/关闭时明确写入 `paddingBottom:0`；保留 focus + native visible 防线、容器及草稿，不改聊天 controller、native Stack 或依赖。使用 `expo-router/react-navigation` 的 `useHeaderHeight()` 与安全区顶部计算原生导航偏移，首页 header 隐藏时补顶部 inset。
- 验收涵盖 hide 在 pop 前后、covered show、取消返回、再次输入、不同键盘高度、header/safe-area 偏移、监听清理及子树身份。自动测试与双平台导出分别记录；iPhone 开键盘直接返回仍待真机确认。

## 验收

自动化：执行实际聊天 route 和 ChatTimeline，验证路由安全区、同一输入 nativeID/gesture area、原生 scroll 参数、兼容开关和 sticky/list offset；结合已安装库的 sticky/clamp 计算覆盖安全区有/无、键盘打开/关闭/交互中间高度、短/临界/长列表、多行输入、阅读位置与新消息动画。执行全量手机测试、TS 和 iOS/Android Metro 导出。

真机单列：中文九宫格开/关、候选栏增高，短列表在文字及下方留白分别下滑收键盘、反向拖回取消，长列表上翻不抢位置，发送后保持键盘，打开设置返回、返回手势与前后台恢复。自动化和导出不代表这些手感已通过。

## 参考

- https://kirillzyusko.github.io/react-native-keyboard-controller/docs/api/components/keyboard-chat-scroll-view
- https://kirillzyusko.github.io/react-native-keyboard-controller/docs/guides/building-chat-app
- 精确实现以项目安装的 `react-native-keyboard-controller@1.21.9` 与 `react-native@0.86.3` 源码为准，不能采用新版文档独有 API。

## 本轮返工验证

- 增量动画样式替身接入后，原实现 4 项测试中 3 项失败，稳定保留 `height:470/flex:0`；日志 `workspace/hermes-app/router-keyboard-height-reset/red.log`。
- 新版执行已安装 RN 0.86.3 KAV 与 controller visibility hook 源码，专项 8/8，全量手机 263/263（0 failed/skipped）；TS、iOS/Android Metro 导出通过。导航生命周期测试同步了新增 hook 的替身，没有改变断线、消息或草稿逻辑。
- 构建/测试日志：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/router-keyboard-height-reset/`。这些是 Node 原生边界替身测试和 JS 导出，不是 iPhone UI 实测，卡片须保留 review。

- 已将 `409479b` 发布原入口 `exps://agent.tuly.space`。两平台公网 manifest 与精确 launchAsset 均确认应用使用 RN KAV/padding、header offset 与 focus/visibility 条件；SDK/账号不变。只重启 Expo，两 Gateway 的 PID/启动时间与本轮发布前一致。
- 发布核验：上述证据目录 `verification.json`；回滚分支 `rollback/router-keyboard-before-409479b` 保留 `1dea030`。下载包已清理，manifest/hash/代码片段/测试日志保留。需要完整 Reload 清掉旧原生视图，而非只依赖 Fast Refresh；iPhone 开键盘直接返回尚待用户验收。

## 返回后首次重进无法弹键盘

Jamie 确认 `409479b` 已修复父页半高，但开着键盘返回后，第一次重进聊天点输入框只有光标、键盘不出现，需要再次退出重进。

- 当前 Expo Router 57.0.23 native-stack 的 `keyboardHandlingEnabled` 默认 false（已安装 `native-stack/types.d.ts`），应用未设置。其值转发为 RNS `hideKeyboardOnSwipe`，iOS `RNSScreen.notifyWillDisappear` 仅在开启时调用 `[self endEditing:YES]`。现有高度修正只恢复布局，没有开启导航离开时的原生输入收尾。
- 最小修正：在根 Stack 显式设置 `keyboardHandlingEnabled: true`，由原生导航在页面离开时结束输入。保留原生返回按钮/侧滑/取消手势、现有高度修正和聊天键盘跟手逻辑，不新增全局 Keyboard.dismiss、延时、强制 focus/blur 重试或重挂 key。
- 上游相近报告：https://github.com/kirillzyusko/react-native-keyboard-controller/issues/1283 。它是支持性证据，不证明 Jamie 的实际 UIKit 事件次序；本轮仅确证默认关闭及原生转发路径。若真机仍失败，下一步需事件追踪，而非继续猜测添加焦点补丁。
- 验收：实际 root 配置执行测试、固定依赖转发源码契约、全量手机/TS/双平台导出；iPhone 按钮返回、侧滑完成/取消、第一次重进点输入、跨聊天/设置返回与草稿保留另验。
- 本地结果：配置回归修正前 1 failed / 1 passed，修正后 2/2；全量手机 265/265，0 failed/skipped，TypeScript 和 iOS/Android Metro 导出通过。日志 `/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/chat-keyboard-refocus/`。这些检查不是 UIKit 焦点复现或真机验收。
- 已发布 `cef0ff6` 到原 Expo 入口；两平台公网精确 launchAsset 已核验 `NativeRoutes` 内 `keyboardHandlingEnabled:true`，并确认 RN padding 高度修正保留。SDK/账号一致，两 Gateway PID/启动时间未变。`verification.json` 为发布证据，回滚分支 `rollback/chat-keyboard-before-cef0ff6` 保留 `12bb928`。下载包已清理，哈希/manifest/源码片段保留；卡片保持 review 等待完整 Reload 后的 iPhone 复测。

## 验证结果

- 修正前运行新增回归：4 项中 3 项失败，分别对应路由安全区缺失、留白触摸兼容项未开启、输入区几何偏移；修正后 4/4 通过。测试辅助查找函数的空结果统一为 null 后，全量稳定通过。
- 初次聊天修正手机测试 255/255；加入跨路由表单高度修正后全量 259/259 通过，0 failed、0 skipped；共享 client build、离线渲染资源生成及 TypeScript 检查通过。
- 新增真实 React + 已安装库 KeyboardAvoidingView / useKeyboardState 测试，覆盖隐藏频道不跟随聊天键盘缩高、返回后 didHide 清除固定高度（故意保留模拟过期动画状态）、隐藏期间关闭后返回、再次输入及取消返回；容器/表单不重挂、草稿保留、监听卸载释放。模拟动画事件顺序不等于在手机复现底层事件遗漏。
- 第二轮日志在上述证据目录 `forms/` 子目录。首次 TS 检查发现新工作树未生成 Markdown 离线资源，按项目生成脚本补齐后检查通过，没有修改依赖或线上资源。
- iOS / Android Metro JS 导出通过；没有构建 IPA/APK，也没有真机触摸或键盘验收。
- 完整日志：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/router-keyboard-safe-area/`。
- 已按 Jamie“发布”授权将 `40a215a`（含 `91adfbf`）快进合入 main 并更新原入口 `exps://agent.tuly.space`，仅重启 Expo；发布目录 TypeScript 与相关 11 项回归通过。
- 两平台公网 manifest 与其精确 launchAsset 已下载，均核验聊天 route 的 bottom/left/right 安全区、应用层触摸兼容开关、表单焦点/键盘可见性条件、SDK57 与原 Expo 账号。普通 urllib 请求收到 403，改用 curl/Expo UA 后 200；没有改变边缘安全规则。验证脚本首次误命中库的属性声明，改为核验应用组件上下文后通过，没有重复部署。
- 开发 Gateway、Jamie 主实例的 PID/启动时间保持不变；插件源文件、字体和依赖/入口配置哈希均与发布前一致。
- 发布证据：上述目录 `release/verification.json`、manifest、代码片段与操作日志。回滚分支 `rollback/router-keyboard-before-40a215a` 指向 `2b47eda`；下载 bundle 在记录哈希与核验片段后清理，源码与日志保留。
- 发布验证不等于 iPhone 手势验收；卡片保持 review，待 Jamie 重载后验证中文键盘、拖动和开着键盘返回频道的实际表现。
