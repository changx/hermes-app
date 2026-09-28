# Expo Router 聊天键盘回归

## 反馈与范围

Jamie 反馈迁移 Expo Router 后：输入区落入底部安全区，打开中文键盘后输入区被挡，消息区不能协调移动，拖动消息区不能收键盘。续接 `default / t_7eb46948`，关联 Router 卡 `t_49b0a1d8`。只修客户端布局与已有键盘库接入；保留原生 Stack、消息跟随/阅读锚点、字体、通信和后端。

## 证据与修正决定

- `2c7dce2` 移除了旧应用根部 SafeAreaView。新的频道、设置、连接、查看页均自行保留 bottom/left/right，但 `src/app/threads/[threadId].tsx` 直接返回 ThreadScreen，没有安全区。ChatTimeline 的 scroll offset 与 sticky opened offset 仍为 `insets.bottom`，依赖其外层已扣除底部安全区；迁移打破了这个布局契约。恢复聊天路由的 bottom/left/right SafeAreaView，不重复添加 native Stack 已占用的顶部导航空间。
- 当前 RN 0.86.3 的 `RCTScrollViewComponentView.betterHitTest` 在内容子视图未命中时返回包装视图，而非内部 UIScrollView。keyboard-controller 1.21.9 的 ClippingScrollViewDecorator 已内置 `applyWorkaroundForContentInsetHitTestBug`，用于让这种留白/inset 区的触摸返回内部 ScrollView。只在聊天滚动组件启用现有兼容项，保留 iOS interactive + 短列表 bounce、Android on-drag，不在 JS onScroll 强制 dismiss。
- 该兼容项使用依赖内的原生运行时 hit-test 修正，不修改 Hermes/RN 源码、不新增依赖或自制手势。源码与官方描述支持此缺陷路径，但没有在 Jamie 的 iPhone 上抓取触摸事件，不能把它称为全部手势故障的确证根因。
- 列表和输入区仍由同一 KeyboardProvider 驱动：列表只添加 keyboard height - bottom inset，dock 同量上移；不再扣 composer 高度，不新增 KeyboardAvoidingView 或系统自动键盘 inset，短列表不使用 flexGrow 撑高内容。

## 验收

自动化：执行实际聊天 route 和 ChatTimeline，验证路由安全区、同一输入 nativeID/gesture area、原生 scroll 参数、兼容开关和 sticky/list offset；结合已安装库的 sticky/clamp 计算覆盖安全区有/无、键盘打开/关闭/交互中间高度、短/临界/长列表、多行输入、阅读位置与新消息动画。执行全量手机测试、TS 和 iOS/Android Metro 导出。

真机单列：中文九宫格开/关、候选栏增高，短列表在文字及下方留白分别下滑收键盘、反向拖回取消，长列表上翻不抢位置，发送后保持键盘，打开设置返回、返回手势与前后台恢复。自动化和导出不代表这些手感已通过。

## 参考

- https://kirillzyusko.github.io/react-native-keyboard-controller/docs/api/components/keyboard-chat-scroll-view
- https://kirillzyusko.github.io/react-native-keyboard-controller/docs/guides/building-chat-app
- 精确实现以项目安装的 `react-native-keyboard-controller@1.21.9` 与 `react-native@0.86.3` 源码为准，不能采用新版文档独有 API。

## 验证结果

- 修正前运行新增回归：4 项中 3 项失败，分别对应路由安全区缺失、留白触摸兼容项未开启、输入区几何偏移；修正后 4/4 通过。测试辅助查找函数的空结果统一为 null 后，全量稳定通过。
- 手机全量测试 255/255 通过，0 failed、0 skipped；共享 client build、离线渲染资源生成及 TypeScript 检查通过。
- iOS / Android Metro JS 导出通过；没有构建 IPA/APK，也没有真机触摸或键盘验收。
- 完整日志：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/router-keyboard-safe-area/`。
- 候选位于隔离分支 `jamie/router-keyboard-safe-area`，尚未合入活动 Expo 目录或发布。现有开发服务和两个 Gateway 均未重启；本轮手机入口更新等待明确发布指令。
