# 历史批次改为 5 个阅读段；回弹协调评估

## 已实现

Jamie 要求每次历史加载由 3 轮改为 5 轮。保留之前确认的简单阅读段定义：每条用户消息为段首，之后的助手/工具/系统输出直到下一用户消息之前归入该段，插话独立计数。

唯一生产代码改动为 `HISTORY_BLOCK_COUNT = 5`；初次/缓存重进和向前展开都使用此默认值。网络页仍 limit=100，后台补齐预算不变。没有修改松手门控、220ms 淡入、FlashList 位置保持或 tail 恢复。配套测试改用足够的 5 段 fixture，并保留不足 5 段的末页处理。

完整 mobile 355/355、TypeScript、iOS/Android Expo 导出与 diff check 通过；实际导出 bundle 验证默认常量为 5。

## 回弹问题的评估（未实现）

用户反馈回弹还没结束就插入历史，画面混乱。当前代码：App 在 onOlder 内完成分页后 setStartRef，ChatTimeline 等 onOlder 返回才在 finally 结束 refreshing；所以插入布局与刷新控件收起没有明确分阶段，缓存快速完成时尤其容易重叠。这个代码时序是已检查的事实；具体设备每帧表现尚未采集。

RN 文档明确 onScrollEndDrag 是停止拖动、可能刚开始滑行，不是全部动画结束。onMomentumScrollEnd 定义为惯性滑行结束，并没有承诺覆盖所有 RefreshControl 收起/回弹。已安装 iOS 原生刷新代码中，refreshing=false 调用 UIRefreshControl.endRefreshing，没有向 JS 暴露专用完成回调。

### 推荐方向

1. 松手后仍及时取数据，先只进入既有 SDK 缓存，保持当前可见 startRef 不变。
2. 数据齐备后先结束原生 refreshing，让控件收起和回弹完成；该期间不改变列表可见窗口。
3. 利用已有原生滚动/惯性事件和实际 offset/运动状态确认稳定，再一次性提交 5 段并淡入。无惯性的回弹不能只等 onMomentumScrollEnd，需验证 offset 回到正常范围、连续数帧稳定的判定；不重造滚动曲线或锚点引擎。
4. 若已经稳定则立即提交，不固定从松手等一秒。新手势、失焦、后台等取消待上屏操作，但已取数据可保留缓存。
5. Markdown 媒体/图表预留尺寸、减少二次排版另行优化；5 段增加本身不保证更流畅，可能增大测量负担。仅淡入不能解决高度和回弹的竞争。

上述是待验证的实现方向，不是本轮已经加入的回弹门控。需要先验证 iPhone 原生事件/offset 序列，不能凭一帧 rAF、JS idle 或固定延迟宣称动画已经结束。

参考（实际检索）：
- https://reactnative.dev/docs/scrollview
- https://reactnative.dev/docs/refreshcontrol
- https://docs.swmansion.com/react-native-reanimated/docs/scroll/useAnimatedScrollHandler/
- 同时只读核对当前 RN iOS ScrollView/PullToRefresh 原生代码。

候选在 `jamie/session-five-block-history`，尚未发布；本轮没有更改回弹行为、运行目录或服务。
证据：`/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/session-five-block-history/`。
