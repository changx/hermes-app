# P1-03 本地接收与同步协议

状态：P1-03 隔离实现，固定单 owner/profile。Hermes 基线 `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`；未安装活动 profile。所有路由使用 `Authorization: Bearer <token>`，WebSocket 升级也必须带该请求头。凭据不进入 URL。服务端从当前 profile 选择数据库，不接受客户端的 profile/owner 参数。浏览器原生 WebSocket 不能设置任意请求头；后续共享客户端必须由支持请求头的桌面/手机原生 socket 工厂提供连接，不能把 token 放进 URL。

## 发送与执行

`POST /v1/threads/{thread_id}/messages` 请求为 `{"client_message_id":"设备生成的唯一 ID","text":"正文"}`。ID 限 1–128 个 ASCII 字母、数字、`-_.:`；正文 UTF-8 最多 16000 字节且非空。成功返回 HTTP 202 和 `{"receipt":{"id":"rc_...","client_message_id":"...","thread_id":"...","state":"queued","durable":true}}`。202 是**持久 accepted 确认**；`state` 描述执行阶段，可能在响应送出前已经前进。`GET /v1/receipts/{id}` 返回当前收据。

同一 `client_message_id`、Thread 和原始正文重试返回原收据，绝不再次派发；改正文或 Thread 返回 409。两次独立发送须使用不同 ID，即使正文相同。正文 SHA-256 仅检查重试载荷一致性，不作消息身份或历史去重。收据 ID 由服务端生成、不透明。接收、临时队列正文及一条 `receipt` 同步事件在同一 SQLite `BEGIN IMMEDIATE` 事务提交后才确认。队列正文只用于交接；以核心 `messages.platform_message_id=receipt.id` 找到原始用户行后清空。核心 SessionDB 是唯一聊天正文来源；同步事件只有引用、版本与状态，不含正文。

每 Thread 同时最多 32 条 `queued/running` 收据，满队列返回 429；请求体上限 64 KiB。普通发送按接收顺序排队，单 Thread 只向核心派发一个 owner；不同 Thread 可以并发。状态为 `queued`、`running`、`completed`、`failed`、`interrupted`、`unknown`。`unknown` 表示执行/副作用边界无法证实，不能自动重试模型或工具；重试相同 client ID 仍返回原收据。崩溃时已经开始的收据变 `unknown`，尚未开始的 `queued` 在重启后重新派发。旧 `unknown` 队首不阻止后续真实 `queued`：它保留原接收顺序和可见状态，执行调度跳过它，不伪称旧执行成功。

实时完成仅在确切 Gateway owner task 结束后结算。正式 `post_llm_call` 的成功原始行引用，或该 owner 已结束且精确入站用户 ID 与 SessionDB `assistant.finish_reason='stop'`、无 tool call 的最终行共同证明完成；失败/中断 hook 仍优先。压缩复制行不覆盖正式 hook 记录的原始引用。重启时若 final 已持久而插件还未写通知，插件按精确入站 ID 补可见原始行引用并发缺失 `message` 事件；没有可恢复的 owner 结束证据时执行仍为 `unknown`。一个已存在的 assistant/interim 行本身不构成完成证明。

## 历史、快照与增量

`GET /v1/threads/{id}/messages?after=<cursor>&limit=1..100` 返回核心可见投影，每条含稳定 `ref_seq`、核心原始 `id`、`role`、`text`。`ref_seq` 是已发布逻辑引用，压缩复制行不会改写已发序号。缺失原始行返回 409；不以摘要伪造原文。

`GET /v1/snapshot?after=<opaque>&limit=1..100` 返回有界 Thread 元数据、最后可见引用、已读引用、实际可见未读数、`next_after` 和在同一 SQLite 读事务取得的准确 `waterline`。分页的每个响应各有水位；客户端先保存首页水位，分页结束后从该水位调用增量即可补上分页期间的变化。

`GET /v1/sync?cursor=<opaque>&limit=1..200` 返回全局持久事件页：`events`、`waterline`、`next_cursor`、`has_more`。无 cursor 表示从头读。每条事件含递增 `event_id`、`cursor`、`kind`、`thread_id`、不透明或数字引用 `ref` 与 `version`。事件只含引用，客户端按需要取收据、快照或历史。cursor 绑定固定 owner/profile 元数据库路径指纹；无效、外 profile、未来或不存在的序号返回 400，必须重新取快照，绝不静默返回空数组。

`WS /v1/events?cursor=<opaque>` 先发送 `hello`，再从相同持久日志发送 `{"type":"event",...}`。HTTP 和 WS 共用序号。断线以最后处理的 cursor 调用 HTTP `/v1/sync`，分页追至水位，再继续订阅。客户端按 `(kind,thread_id,ref)` 和 `version/event_id` 合并重复、乱序投递；流式 token 不写永久日志。服务端对单 socket 设 1 MiB 写缓冲和 5 秒发送超时，慢客户端断开后从 cursor 补齐；无每客户端无限事件队列。认证在升级时校验，运行时凭据轮换后旧 socket 最迟在下一次 5 秒唤醒时关闭；停用/关闭立即释放 listener、socket 和 task。

`POST /v1/threads/{id}/read` 请求 `{"ref_seq":<已知可见引用>}`；服务端验证该 Thread 的引用，只单调前进，返回 `ref_seq` 和 `unread_count`。未读数为此引用之后真实可见消息数，而非同步事件数；变更写入 `read` 事件，多端见同一 owner 的位置。未知引用返回 400。

## 固定源码边界

- `BasePlatformAdapter.handle_message`、`_session_tasks` 与 `MessageEvent.message_id`：只在适配器内使用，`platform_message_id` 由核心入站路径写入 SessionDB；收据持久化不依赖 `_gateway_accepted`。
- `gateway/run_startup.py::_run_startup_resume_event`：内部空消息调用本 adapter 的 `handle_message`。本 adapter 只拦截这类内部空消息，防止核心与插件对同一旧执行同时恢复；其他平台不受影响。恢复队列等待固定基线 `GatewayRunner._startup_restore_in_progress` 关闭后派发。适配器从基线的 `_standalone_scoped` 回调读取此标志；基线升级须重新验证此私有边界。
- 正式 `pre_llm_call`、`post_tool_call`、`pre_auxiliary_call`、`post_llm_call`、`on_session_end` 保留 P1-02 的原始行捕获。插件不修改、复制或 monkey patch Hermes 核心。

本阶段未实现 P1-04 审批/附件/主动任务投递或 P1-05 TS 客户端。跨进程运行中的外部工具副作用不承诺 exactly once；已开始但边界不明的执行保持 `unknown`，等待用户显式处理。
