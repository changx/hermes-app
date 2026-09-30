# 历史下拉：松手一秒后加载，固定原消息顶部

## 反馈与验收规则

Jamie 反馈已发布的 `b8b7be7` 在真实操作中仍跳到不明确的位置。新要求：松手满一秒后才开始加载；旧历史 prepend 时，原消息顶部保持在松手时的屏幕位置，不重新挑选中部消息。

## 修正

- drag-end 保存第一条原有可见消息的稳定 key 和顶部屏幕坐标。使用已提交的 native cell content-layout y、松手时的原生 contentOffset 和列表视口屏幕顶部，不在回弹后重新选择阅读记录。
- onRefresh 先于松手时等待 drag-end；先松手后收到 onRefresh 时只等待剩余时间。计时从松手开始，满 1000ms 才执行原有 onOlder，包括缓存展开路径。
- 保留受控进度和请求锁；延迟期间离开页面、再次主动拖动、点击 latest/主动发送或卸载可取消。到期重新校验当前聚焦、历史耗尽和定位状态。
- 保留原生 maintainVisibleContentPosition。原消息 prepend 后的真实 cell layout 到达时，用绝对目标 `cellContentY + viewportScreenY - savedMessageScreenY` 作不带动画的滚动修正，不组合异步 screen measurement 与随后发生变化的 contentOffset，也不累加内容总高度。
- 同一目标等待原生确认期间不重复发送；原生已对齐则不补偿。刷新回弹及上方动态高度变化仍使用同一个固定 key/屏幕坐标。
- 原消息布局尚未更新时不猜测位置；其他消息布局、总高度更新和初始 restored offset 不可覆盖该锚点。已卸载 cell 的旧 layout 删除，避免在后续长历史中复用错误几何。
- 无可用原消息几何时不加载该次历史，避免任意跳位；下一次有效手势可重试。正常非刷新拖动不激活补偿。

## 验证与边界

317 项 mobile 自动测试、TypeScript、iOS/Android Expo 导出和 diff check 通过。

回归测试使用明确的模拟原生布局和可控时钟，覆盖松手后 999ms 不加载/1000ms 加载、刷新早于松手、迟到刷新、固定第一条原消息（而非中部）、回弹、原生位置保持不重复补偿、原消息 layout 到达立即修正、动态高度、缓存、失败后重试、失焦/卸载/新手势取消和过期加载条件。

旧代码混合不同时间的屏幕测量和滚动偏移是代码层风险；未将它冒充为已在 iPhone 定位的唯一原因。Jamie 的实机反馈说明之前的模拟测试不足以证明体验正确。本轮也未获得实际 iPhone 无跳动验收，不能保证原生插入/刷新动画间没有可见瞬态。

本轮候选位于隔离分支 `jamie/session-release-delay`，尚未更新运行入口。没有改服务器、协议、核心、依赖、Gateway 或另一个任务的文档。

证据：`/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/session-release-delay/`。
