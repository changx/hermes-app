# 历史新增内容淡入

## 用户要求与边界

Jamie 要求历史添加时有动画，避免新内容瞬间跳出来难以跟踪；同时反馈 Markdown 二次渲染的高度变化仍会影响锚点。这次只柔化新内容出现，不宣称解决 Markdown 动态高度，也不重写滚动/渲染框架。

## 实现

- 使用已安装 Reanimated 官方 `FadeIn.duration(220).reduceMotion(ReduceMotion.System)`，只插值 opacity，不做位移、缩放、高度或滚动动画。
- 仅在真正的历史展开之后，给原首条消息之前新增的稳定 key 标记一次淡入。初次进入、最新消息 append、Markdown 原地更新、已有消息和 FlashList 测量/粘性副本不淡入。
- 使用消息原有根 View 的 Animated 版本，保留原样式/树形结构，不新增外层测量/气泡包装；用户气泡只在外层淡入一次，系统通知保持辅助阅读标签。
- 真正 Cell 提交后消费其 key，滚离/重新挂载不重复淡入。每条消息实例保存最初的 entering 配置，普通更新不改变 animation/nativeID 或重新挂载富内容。
- 减少动态效果、后台/失焦、新主动手势取消未提交的入场标记。动画不新增请求、等待时间或手势次数限制。
- FlashList 的 maintainVisibleContentPosition 不变，不调用 prepareForLayoutAnimationRender 或 LayoutAnimation.configureNext。核对已安装 FlashList 源码：layout-animation preparation 会切换 animationOptimizationsEnabled，影响位置补偿，因此本轮不用移动布局的动画路径。
- 按 3 段加载、独立 tail 恢复、SDK、依赖、服务端和核心均不改。

## 验证

- 6 项新增组件回归覆盖仅新 prepend、初次/旧行/measurement 不动画、实际已安装 FadeIn builder 的返回值仅 opacity、220ms 与 system reduced motion、已提交 key 不重播、消息内容不重新挂载、用户只一次淡入、系统 notice 辅助阅读、Markdown/append 不动画、后台与手势取消。
- 测试执行真实 React 组件和已安装 FadeIn builder，时序/原生视图为明确替代对象，不能当作 iPhone 原生动画帧的证明。
- 完整 mobile **348/348**、TypeScript、iOS/Android Expo 导出、diff check 通过。既有键盘和消息宽度/样式回归保留；没有为通过测试放宽样式预期。
- 物理 iPhone 的视觉节奏及 Markdown 高度变化时锚点仍待验收。轻微移动不是本次动画已解决的事实。

本轮候选在隔离分支 `jamie/session-history-enter-animation` 验证后，经 Jamie 明确要求“部署”，将提交 `e23813b` 快进合入 main 并更新现有手机测试入口。

## 授权发布记录

- 发布目录再次通过 TypeScript 与完整 mobile 348/348；仅重启用户级 `hermes-app-expo.service`。
- iOS/Android 公网 manifest 及各自实际 launchAsset 确认官方 FadeIn 220ms/system reduced motion、只对新增历史 Cell 入场、已提交 key 不重播、稳定 entering 配置；未使用列表布局动画准备。
- App.tsx、historyBlocks.ts、共享 SDK 源码发布前后 SHA-256 一致，历史 3 段分页和恢复数据流没有改动。
- Jamie 和开发 Gateway 的 PID、启动时间、状态与发布前一致；其他任务的两个工作区文档哈希一致，未提交它们。
- 入口保持 `exps://agent.tuly.space`，需要 Expo Go 完整 Reload。真实 iPhone 的视觉效果和 Markdown 高度变化仍待反馈，不将公网代码验证当作动画观感验收。
- 回滚分支 `rollback/session-history-enter-before-e23813b` 指向发布前 `6afdf31`。仅恢复本轮客户端变化并重启 Expo，不覆盖其他任务工作区修改。
- 私有发布证据在下方目录 `release/release-verification.json`，包含两平台实际 bundle 哈希、检查项、数据流源码哈希与 Gateway 状态；另保存发布目录测试日志。
- 没有核心/plugin/服务端/依赖变更，没有重启 Gateway、远程推送或发布签名安装包。

证据：`/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/session-history-enter-animation/`。

参考：[Reanimated entering/exiting](https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/entering-exiting-animations/)、[FlashList LayoutAnimation](https://shopify.github.io/flash-list/docs/guides/layout-animation/)（本轮实际查阅）；同时核对当前安装版本的 FadeIn/AnimatedComponent 和 FlashList controller 源码。
