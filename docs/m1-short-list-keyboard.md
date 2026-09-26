# 短消息列表键盘回归

## 现象与证据

Jamie 在 iPhone 上反馈：只有一两条消息时打开键盘，消息被顶出可视区。代码中 `ChatTimeline` 的 `messages.flexGrow:1` 将内容高度撑至 viewport，而消息仍顶部对齐。锁定的 keyboard-controller 1.21.9 `useChatKeyboard` 使用实际 content size，通过 `clampedScrollTarget` 将位移限制为 `max(contentHeight - viewport + keyboardInset, 0)`；被撑高的 content size 抹掉了消息下方空白，所以允许按完整键盘高度上滚。该路径可用实际生产 style 与库 helper 的组合测试复现；尚未在本机运行 iPhone。

## 最小修正

只取消消息 contentContainer 的 flexGrow，保留列表及其父容器 flex:1、顶部排版、短列表 alwaysBounceVertical、原生键盘 inset 和 interactive 手势。让原生组件先消耗真实底部空白，只有被键盘遮住的内容才滚动。不新增 JS 键盘尺寸补偿或计时器，不改消息、网络、配对、reaction 或后端。

验收：生产 style + 锁定库 helper 测试覆盖空/一两条/刚溢出/长列表、不同 dock 高度、键盘高度和收起；全 mobile 测试、TS、双平台导出；发布后公网 manifest 与 bundle 核验。真机短列表可见性、拖动及长列表阅读位置仍须单列确认。

## 本地验证

实际先 RED 后 GREEN：旧 style 下短列表与临界内容两项失败（不应上滚却上滚、临界内容过度上滚）；取消 flexGrow 后三项全部通过。全手机测试65/65、TypeScript、iOS与Android Metro导出、git diff --check通过。首次全测试因新worktree尚无SDK dist而失败，先从同版本SDK源码构建再运行通过；不将环境缺失冒充产品失败或忽略。无新增依赖。

该回归测试执行真实生产 style 和锁定库 helper，但内容测量按 flexGrow 规则建模，不是 Yoga/原生渲染或 iPhone 手势验收。
