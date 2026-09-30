# 历史 prepend：改用 FlashList v2

## 本轮用户确认

前面发布的自制位置补偿在真机仍会跳位。Jamie 明确要求采用成熟方案，允许松手位置轻微变化，只要能自然继续阅读；随后明确去掉松手后一秒加载的限制。

## 实现

- 固定安装 `@shopify/flash-list` **2.3.2**，与现有 React 19 / RN 0.86 New Architecture 配合。只新增这一个包，lockfile 没有升级其他依赖。
- ChatTimeline 改用 FlashList v2，保持现有稳定 `row.key`。使用稳定配置 `{ disabled: false }`，不设置自动滚到顶部或底部的阈值。历史 prepend 的位置保持由列表内部统一处理；最新跟随/主动发送/点击 latest 沿用原规则。
- 删除 `historyAnchor.ts`、消息 cell/window 测量、松手坐标快照、app-level prepend `scrollToOffset` 补偿、额外 cell renderer、等待松手与 1000ms 计时器。
- 原生下拉直接调用现有 onOlder Promise，保留受控进度、重复请求锁、聚焦/定位/耗尽保护、原缓存扩窗和权威 cursor 分页。
- 继续透传 KeyboardChatScrollView 的原生 ref、位置保持配置与 RefreshControl，保留键盘关闭方式、safe-area 和 latest dock。
- 富消息内部包含图片加载、视频播放和 WebView 状态。采用 FlashList 官方支持的 `maxItemsInRecyclePool={0}` 非回收模式，避免将这些状态复用给另一条消息；仍使用虚拟列表，不引入自制回收算法。此选项的性能/内存需要真机观察。

## 自动验证

- TypeScript 通过。
- 完整 mobile **312/312** 测试通过。删除了已被用户取消的“必须一秒”和“必须完全恢复松手像素坐标”测试；保留网络/焦点/错误/样式/键盘/最新跟随回归，新增成熟列表配置与无 competing correction 的检查。
- 8 项 history regression 全通过。其中一项直接加载已安装 FlashList 的真实 `useRecyclerViewController` 源码，以可控 layout-manager/native-anchor 输入验证长 prepend 后原 key 离开 engaged window、后续高度 refinement 仍保留同一锚点。没有重写其位置保持算法，也没有将 mock native command 的结果冒充为真机成功。
- iOS 与 Android Expo 导出通过，实际 bundle 包含新依赖。diff check 通过。
- npm audit 与发布前基线对比：相同的 13 个 moderate，0 high/critical，没有新受影响包；没有借本轮运行 audit fix 或升级 SDK。

## 交付边界

本轮候选在隔离分支 `jamie/session-flashlist-history`。未更新运行入口、未重启 Expo/Gateway，未动其他任务工作区文档；发布需对应授权。

实际 iPhone 的“能轻松继续阅读”验收仍待确认：多次 prepend、长短 Markdown、图片/图表/附件动态高度、键盘显隐和慢网/错误恢复。库已有上游实现不等于本项目真机已经通过。允许轻微移动，不接受跳到陌生消息或重新寻找阅读位置。

证据：`/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/session-flashlist-history/`。

参考：[FlashList 用法](https://shopify.github.io/flash-list/docs/usage/)、[v2 迁移](https://shopify.github.io/flash-list/docs/v2-migration/)、[官方 Chat](https://github.com/Shopify/flash-list/blob/main/fixture/react-native/src/Chat.tsx)、[长内容 prepend 修复](https://github.com/Shopify/flash-list/pull/2138)。本轮也核对了已安装 2.3.2 的实际源码和 ref/scroll 配置透传。
