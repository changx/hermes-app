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

本轮候选在隔离分支 `jamie/session-history-enter-animation`，尚未部署；没有修改运行目录或重启服务。

证据：`/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/session-history-enter-animation/`。

参考：[Reanimated entering/exiting](https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/entering-exiting-animations/)、[FlashList LayoutAnimation](https://shopify.github.io/flash-list/docs/guides/layout-animation/)（本轮实际查阅）；同时核对当前安装版本的 FadeIn/AnimatedComponent 和 FlashList controller 源码。
