# 手机 Session 历史：普通 ScrollView 一次渲染

状态：已实现（候选分支 `refactor/session-scrollview`）；iPhone/Android 真机未验收。

## 决定

- 打开 session 时，客户端用 `full=true` 一次读取完整历史。没有上限、分块或下拉加载更早消息。
- 手机时间线不再使用 FlashList。`ChatTimeline` 用 `KeyboardChatScrollView`（普通原生 ScrollView）一次渲染全部行。
- 依据 Jamie 的决定，本次不做长历史性能测试。

## 替代 FlashList 的实现

- 跟随最新：直接调用 ScrollView 的 `scrollToEnd`。
- 已读与目标高亮：每行 `onLayout` 记录 y/高度，按滚动偏移计算可见 `ref_seq`，替代 `onViewableItemsChanged`。
- 来源消息定位：目标行完成布局后 `scrollTo({ y })`，替代 `initialScrollIndex`。
- 首帧：在首次定位到底部或目标行前隐藏列表（最长 600ms），避免先显示顶部再跳动。

## 删除的内容

- `@shopify/flash-list` 依赖；`Attachments` 的 `useLayoutState` 改为 `useState`。
- 下拉加载、"Pull down for earlier messages" 提示、历史边界线和入场动画。
- `historyBlocks.ts`、`historyLayout.ts`、`windowStart`/`olderStart`/`scrollToExactEnd`、App 的 `pageCursor`/`startRef`/`loadOlder`。

## 验收

自动：手机 TypeScript、单元测试、iOS/Android 导出。真机仍需检查：打开即在底部、键盘、跟随/上翻、来源消息定位、已读清除。
