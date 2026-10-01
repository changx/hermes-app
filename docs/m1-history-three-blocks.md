# 手机历史按 3 个阅读段加载

## 已确认规则

Jamie 先要求按轮次整块加载，随后确认简单边界即可，插话不做复杂归属处理：每条用户消息是一个阅读段的起点，后续助手说明、工具记录、结果展示与系统通知归入该段，直到下一条用户消息之前。初次进入取最新 3 段，每次下拉再增加更早的 3 段。插话算新的段，不推断处理轮次，也不重排或智能归并。

这里是阅读分页规则，不冒充 Hermes 执行 turn。仍在进行的一段显示目前已有内容，后续输出沿用实时同步；不等待模型完成才显示。历史不足 3 段时显示已有内容。无用户锚点的旧 assistant-only 历史保留，不删除或猜补用户消息。

## 实现与范围

- 新增 mobile `historyBlocks.ts`，唯一默认配置 `HISTORY_BLOCK_COUNT = 3`。
- 优先从 HermesClient 权威缓存寻找更早的 3 条用户边界，不够则沿现有 opaque older_cursor 继续拉取。Wire API 仍是固定记录数分页（首次沿用 latest page，补齐请求 limit=100），只是 UI 不再把网络页当成阅读页；没有声称服务器新增按 turn 查询能力。
- 多个网络页可用于完成一次 3 段加载。每次完整找到边界后仅提交一次 startRef，避免把一段长回复的中间部分先插入列表。当前原消息 key/顺序不变，继续使用 FlashList 2.3.2 的内部位置保持，没有新增滚动补偿。
- 初次进入、缓存重进、旧协议定位到最新后的起点、下拉缓存和网络分页均采用同一阅读规则。
- 当前 visible startRef 在后台补齐期间保持；成功网络页保留其 cursor 进度，后续失败不展开半段，重试继续使用缓存和已推进游标。重新取 latest 不覆盖已经追踪更老缓存的 cursor。
- 每次补齐最多请求 20 个额外页，防止异常游标或极长历史造成无限请求。预算耗尽、游标不推进或网络失败时保留原阅读内容并提示错误；下一次可继续已有进度。未声称特别长的段在单次预算内一定能取完。
- 焦点/页面代次保护仍有效，隐藏页面不提交显示边界、游标或已读状态。新协议补齐失败后的入口不会把 backward cursor 错交给旧协议 forward history。
- 不改 plugin、服务端 API、Hermes 核心、依赖或桌面。没有读取真实聊天数据。

## 验证

- 完整 mobile **327/327** 测试、TypeScript、iOS/Android Expo 导出及 diff check 通过。
- 新增 15 项回归：短长混合、长回复超出一页、工具/通知不计轮、插话独立计数、缓存展开、初次 3 段、跨页补齐、末页不足、空/孤立回复、空过滤页、异常 cursor、请求预算、失败后重试、失焦、生产 App 回调只一次发布窗口、缓存重进与 oldest cursor 保持。
- 使用实际 HermesClient 和生产 App 回调，HTTP 为明确的合成分页响应；没有将合成响应当作公网结果或真实聊天。原有 FlashList 已安装源码的长 prepend / layout refinement 回归继续通过。
- 物理 iPhone 的段数、完整起点、连续下拉与阅读稳定性仍待确认；自动测试和导出不等同于真机验收。

本轮候选在隔离分支 `jamie/session-three-turn-history`，未更新运行入口、未重启 Expo 或 Gateway。用户本次授权为“改”，未单独要求本轮发布。

证据：`/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/session-three-turn-history/`。
