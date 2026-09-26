# P1-03 本地接收与同步协议

状态：P1 本地集成候选，固定单 owner/profile。Hermes 基线 `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`；未安装活动 profile。普通 HTTP 请求和 WebSocket 升级请求都须带 `Authorization: Bearer <管理员或已配对设备凭据>` 请求头；唯独配对 exchange 不带 Authorization，配对码只在 JSON 正文。凭据不进入 URL。服务端从当前 profile 选择数据库，不接受客户端的 profile/owner 参数。浏览器原生 WebSocket 不能设置任意请求头；共享客户端由支持请求头的桌面/手机 socket 工厂提供连接。

## M1 本地设备配对（源码实现，未部署）

固定单 owner，无新账号/OAuth/refresh 服务。旧 `HERMES_APP_TOKEN` 保留作为管理员 bootstrap，**不是供普通用户寻找、修复或输入的登录凭据**。管理员在本地受控终端使用已有环境变量调用下面的签发 API；不得把管理员令牌发给设备或把配对码、设备凭据写入 URL、日志、诊断/深链。网络入口仍只绑定 loopback，远程手机接入依赖已有安全传输/受控代理，此改动不开放监听。

| 操作 | 请求 | 成功响应 | 权限 |
|---|---|---|---|
| 签发 | `POST /v1/pairing/grants`，JSON `{}` | `201 {"code":"XXXX-XXXX-XXXX-XXXX","expires_at":<Unix 秒>}` | 管理员 Bearer |
| 兑换 | `POST /v1/pairing/exchange`，JSON `{"code":"XXXX-XXXX-XXXX-XXXX","device_name":"iPhone"}`，**无 Authorization** | `201 {"device_id":"<24 位小写 hex>","device_token":"ha_dev_<device_id>_<随机串>"}` | 唯一公开路由 |
| 列表 | `GET /v1/pairing/devices` | `200 {"devices":[{"device_id":"...","device_name":"...","created_at":<Unix 秒>}]}` | 管理员 Bearer |
| 撤销 | `DELETE /v1/pairing/devices/{device_id}` | `204` | 管理员 Bearer |

正常 HTTP/WS 使用 `Authorization: Bearer <device_token>`；客户端必须安全持久保存它，重启/断线后直接恢复，不请用户修复 token。管理员 Bearer 也继续可用；设备凭据访问普通单 owner 数据路由，但签发、列表、撤销一律禁止（403）。过期、错误、已用配对码统一 400；缺少普通路由认证为 401；签发容量或兑换频率限制为 429；请求为精确字段 JSON，配对请求体至多 512 字节，不允许在 exchange URL 传码。代码一次展示、5 分钟有效、80 位随机熵，服务端仅存 SHA-256 摘要；一笔 SQLite 事务消费代码并建立 256 位随机设备凭据，仅存摘要。限 20 条活跃签发、100 个活跃设备，兑换全局 SQLite 计数每分钟至多 30 次、每小时至多 300 次，重启不清空；反向代理对公开入口另行限流。兑换响应丢失时**不返还凭据**，管理员从列表识别并撤销孤儿设备，再签新码；不能把旧码反复兑换。显式撤销使下个 HTTP 请求 401、已有 WS 在下一次认证检查关闭（最迟约 5 秒）。列表不返回 token，撤销后该设备无法自行重新配对。

管理员本地签发示例（已有 `HERMES_APP_TOKEN` 环境变量，`HERMES_APP_PORT` 为实际监听端口；只在受控终端展示响应，不要开启 shell trace/HTTP body 日志）：

```sh
curl --fail-with-body -sS -H "Authorization: Bearer $HERMES_APP_TOKEN" -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:${HERMES_APP_PORT}/v1/pairing/grants
```

## 发送与执行

`POST /v1/threads/{thread_id}/messages` 请求为 `{"client_message_id":"设备生成的唯一 ID","text":"正文"}`。ID 限 1–128 个 ASCII 字母、数字、`-_.:`；正文 UTF-8 最多 16000 字节且非空。成功返回 HTTP 202 和 `{"receipt":{"id":"rc_...","client_message_id":"...","thread_id":"...","state":"queued","durable":true}}`。202 是**持久 accepted 确认**；`state` 描述执行阶段，可能在响应送出前已经前进。`GET /v1/receipts/{id}` 返回当前收据。

同一 `client_message_id`、Thread 和原始正文重试返回原收据，绝不再次派发，Thread 归档后亦然；归档后新 ID 发送返回 409。归档检查与接收写入同一事务；改正文或 Thread 返回 409。两次独立发送须使用不同 ID，即使正文相同。正文 SHA-256 仅检查重试载荷一致性，不作消息身份或历史去重。收据 ID 由服务端生成、不透明。接收、临时队列正文及一条 `receipt` 同步事件在同一 SQLite `BEGIN IMMEDIATE` 事务提交后才确认。队列正文只用于交接；以核心 `messages.platform_message_id=receipt.id` 找到原始用户行后清空。核心 SessionDB 是唯一聊天正文来源；同步事件只有引用、版本与状态，不含正文。

每 Thread 同时最多 32 条 `queued/running` 收据，满队列返回 429；请求体上限 64 KiB。普通发送按接收顺序排队，单 Thread 只向核心派发一个 owner；不同 Thread 可以并发。状态为 `queued`、`running`、`completed`、`failed`、`interrupted`、`unknown`。`unknown` 表示执行/副作用边界无法证实，不能自动重试模型或工具；重试相同 client ID 仍返回原收据。崩溃时已经开始的收据变 `unknown`，尚未开始的 `queued` 在重启后重新派发。旧 `unknown` 队首不阻止后续真实 `queued`：它保留原接收顺序和可见状态，执行调度跳过它，不伪称旧执行成功。

实时完成仅在确切 Gateway owner task 结束后结算。正式 `post_llm_call` 的成功原始行引用，或该 owner 已结束且精确入站用户 ID 与 SessionDB `assistant.finish_reason='stop'`、无 tool call 的最终行共同证明完成；失败/中断 hook 仍优先。压缩复制行不覆盖正式 hook 记录的原始引用。重启时按 Thread 已拥有的 session 和已发布原始用户锚点继续查找，保留原有引用顺序，并为已落库但未发布的 final 补一条 `message` 事件；复制的用户行不成为第二条可见消息。没有可恢复的 owner 结束证据时执行仍为 `unknown`。一个已存在的 assistant/interim 行本身不构成完成证明。

## 历史、快照与增量

`GET /v1/threads/{id}/messages?after=<cursor>&limit=1..100` 返回核心可见投影，每条含稳定 `ref_seq`、核心原始 `id`、`role`、`text`。`ref_seq` 是已发布逻辑引用，压缩复制行不会改写已发序号。缺失原始行返回 409；不以摘要伪造原文。

已有客户端可用 `after_ref_seq=<已知且属于该 Thread 的引用>` 读取有界增量页；它与 `after` 互斥。不存在或越权引用返回 400。新客户端首次加载仍用普通分页，后续消息失效事件仅取已知末尾之后的页。

`GET /v1/snapshot?after=<opaque>&limit=1..100` 返回有界 Thread 元数据、最后可见引用、已读引用、实际可见未读数、`next_after` 和在同一 SQLite 读事务取得的准确 `waterline`。分页的每个响应各有水位；客户端先保存首页水位，分页结束后从该水位调用增量即可补上分页期间的变化。

集成契约：每个 Thread 摘要另含 `active_receipts`（运行与排队收据合计至多 32 个，其中运行收据至多一个，与发送接收上限一致）及 `pending_interactions`（至多 20 个当前代际请求，含精确请求、收据、代际、提示和选择）。超界返回明确 409，不能静默截断。这些状态和 `waterline` 在同一元数据读事务读取。新设备先分页快照，再从首页水位追事件；结算或过期事件使旧请求从 UI 收起。已有收据仍可由精确 ID 查询，不从全局零位重放。

Channel 正文仍由 Hermes ProjectDB 管理，`GET /v1/channels` 返回当前权威列表。Channel 创建、改名、Description 编辑、删除各写一条持久 `kind=channel` 失效事件，`thread_id` 为空，`ref` 为 Project ID，`version` 按该 ID 递增；删除后列表不再包含该 ID。Thread 创建和归档沿用 `kind=thread` 事件。初次连接先取 `/v1/snapshot` 保存首页水位，再取 `/v1/channels`，最后从该水位追 `/v1/sync`；增量收到 Channel 事件后重取 `/v1/channels`，收到 Thread 事件后取对应 Thread 或快照。Project 写入与插件事件之间若崩溃，启动时按 ProjectDB 对账补事件；`/v1/sync`、`/v1/snapshot` 和 `/v1/channels` 读取前也会对账。两库不共享事务，短暂断开需从游标补齐。

`GET /v1/sync?cursor=<opaque>&limit=1..200` 返回全局持久事件页：`events`、`waterline`、`next_cursor`、`has_more`。无 cursor 表示从头读。每条事件含递增 `event_id`、`cursor`、`kind`、`thread_id`、不透明或数字引用 `ref` 与 `version`。事件只含引用，客户端按需要取收据、快照或历史。cursor 绑定固定 owner/profile 元数据库路径指纹；无效、外 profile、未来或不存在的序号返回 400，必须重新取快照，绝不静默返回空数组。

`WS /v1/events?cursor=<opaque>` 先发送 `hello`，再从相同持久日志发送 `{"type":"event",...}`。HTTP 和 WS 共用序号。断线以最后处理的 cursor 调用 HTTP `/v1/sync`，分页追至水位，再继续订阅。客户端按 `(kind,thread_id,ref)` 和 `version/event_id` 合并重复、乱序投递；流式 token 不写永久日志。服务端对单 socket 设 1 MiB 写缓冲和 5 秒发送超时，慢客户端断开后从 cursor 补齐；无每客户端无限事件队列。认证在升级时校验，运行时管理员令牌轮换或设备凭据被撤销后旧 socket 在下一次约 5 秒唤醒时关闭；停用/关闭立即释放 listener、socket 和 task。

`POST /v1/threads/{id}/read` 请求 `{"ref_seq":<已知可见引用>}`；服务端验证该 Thread 的引用，只单调前进，返回 `ref_seq` 和 `unread_count`。未读数为此引用之后真实可见消息数，而非同步事件数；变更写入 `read` 事件，多端见同一 owner 的位置。未知引用返回 400。

## 固定源码边界

- `BasePlatformAdapter.handle_message`、`_session_tasks` 与 `MessageEvent.message_id`：只在适配器内使用，`platform_message_id` 由核心入站路径写入 SessionDB；收据持久化不依赖 `_gateway_accepted`。
- `gateway/run_startup.py::_run_startup_resume_event`：内部空消息调用本 adapter 的 `handle_message`。本 adapter 只拦截这类内部空消息，防止核心与插件对同一旧执行同时恢复；其他平台不受影响。恢复队列等待固定基线 `GatewayRunner._startup_restore_in_progress` 关闭后派发。适配器从基线的 `_standalone_scoped` 回调读取此标志；基线升级须重新验证此私有边界。
- 正式 `pre_llm_call`、`post_tool_call`、`pre_auxiliary_call`、`post_llm_call`、`on_session_end` 保留 P1-02 的原始行捕获。插件不修改、复制或 monkey patch Hermes 核心。

P1-03 原始交付未含 P1-04 审批/附件/主动任务投递或 P1-05 TS 客户端；以下记录 P1-04 的后续增量。跨进程运行中的外部工具副作用不承诺 exactly once；已开始但边界不明的执行保持 `unknown`，等待用户显式处理。

## P1-04 本地增量（待主控复核）

本节描述隔离插件实现；前述 P1-03 收据、历史、同步、Description 一次性初始化规则保持不变。HTTP/WS 使用同一 Bearer 认证。所有 `id` 均为服务端不透明引用；路由中的 Thread 必须属于当前固定 owner/profile，不能以请求参数改选 profile。

### 审批、澄清与停止

- 核心仍拥有审批策略、队列与超时。插件仅通过 adapter 的正式 `send_exec_approval`/`send_clarify` 呈现请求；记录 `request_id/clarify_id`、Thread、执行收据、当前进程代际、允许选择与最小提示信息。`GET /v1/threads/{id}/interactions/{request_id}` 返回此状态；`POST .../answer` 使用 `{"choice":"...","receipt_id":"rc_...","generation":"..."}`，后两项必须与当前请求完全一致。未知或其他 Thread 的 ID 为 404，错误选择为 400，过期/已答/旧代际/收据不符为 409。审批调用核心 `resolve_gateway_approval(...,request_id=精确ID)`；澄清调用 `resolve_gateway_clarify(精确ID,...)`，没有 oldest/resolve_all/自动同意后备路径。成功答复持久写 `interaction` 失效事件；两个设备竞争只有一个赢得核心 waiter，其他设备从事件收起卡片。
- 运行结束、核心 waiter 超时或中断时交互过期；进程重启先将旧代际所有 pending 标为 expired，旧按钮不能作用于新执行。交互只是短期控制元数据，历史正文仍只来自 SessionDB。
- `POST /v1/threads/{id}/stop` 停止该 Thread 当前 owner：调用核心硬中断路径，清除该 Session 的澄清 waiter、撤回该 Thread 精确审批 waiter；返回是否找到当前执行。`POST /v1/threads/{id}/receipts/{receipt_id}/cancel` 只取消仍 queued 的收据并清空未派发正文，失败返回 409。其他 Thread 不受影响。核心工具的实际外部副作用仍以核心中断与工具自己的中断协作为界，不能把网络请求取消当成工具已停止。

### 附件

`POST /v1/threads/{id}/attachments` 接收原始请求流，`X-File-Name` 为供下载展示的单个文件名；每文件最多 10 MiB，每消息最多 8 个附件，单 Thread 未附上传最多 64 个或共 64 MiB（超限返回 429，用户删除不用的上传后重试），空文件、路径分隔符及控制换行被拒绝。文件写入 profile 内 `hermes-app/attachments/` 的随机临时文件，`fsync` 后原子更名为 `att_` 不透明 ID；传输中断、超限或元数据写入失败会移除临时/孤立文件。服务端根据文件名选安全 MIME，HTML/SVG/JavaScript 强制作为二进制下载。

`GET /v1/threads/{id}/attachments/{attachment_id}` 严格检查 Thread/元数据、`O_NOFOLLOW`、普通文件与大小；返回 `Content-Disposition: attachment` 和 `nosniff`。`DELETE` 只可删除**尚未附到收据**的上传；已附文件随归档 Thread 保留，不能借此删除原文或其他 Thread 文件。`POST /v1/threads/{id}/messages` 可加 `"attachments":["att_..."]`；接收事务校验同 Thread、未被领取，并绑定收据。重试同一 client ID 必须保持正文及附件 ID 完全相同。派发时将受控本地路径、MIME 和未内联标记放进核心 `MessageEvent.media_urls/media_types/media_text_inlined`，让 Agent 使用现有附件机制。插件仅保存文件元数据和收据引用，不另建聊天正文库。失败未附上传由用户显式 DELETE；启动时仅清理本插件命名且没有元数据的孤立文件和中断上传临时文件（最多检查 10000 项），不自动广泛清理或删除归档历史。

### 主动投递与搜索

可见原始 USER 行的 `attachments` 字段由收据的权威 `user_row_id` 映射到附件元数据，包含 ID、文件名、MIME、大小及 `state=available|missing`；压缩复制行不重新认领附件。`GET /v1/threads/{id}/attachments/{attachment_id}/metadata` 供附件失效事件查询；未知或已删除 ID 返回明确 `state=deleted`，跨 Thread 不泄漏元数据。二进制 GET 仅下载现存文件；Agent 入站路径必须先以 `O_NOFOLLOW` 打开并校验普通文件及大小，防止上传后 symlink 替换。

真实 cron job 的 `deliver=origin` 目标须含本插件的 Project chat ID 与 Thread ID，并显式 `attach_to_session=false`，避免核心再次镜像到会话。adapter 从核心 cron 执行账本取得当前执行 ID；只接受已认领或运行中的新投递。以执行 ID 在核心 SessionDB 写一条 `assistant` 原始行（`platform_message_id=cron:<execution_id>`），再在插件发布稳定引用和 `message` 事件；崩溃窗口以该核心行补引用，同一执行重投不再生成第二条，两个不同执行即使正文相同也各有引用。普通 Agent final 已由核心写入，不经此路径重复保存。

`GET /v1/threads/{id}/search?q=<text>&after=<opaque>&limit=1..100` 扫描当前 Thread 已发布的可见原始引用，每页最多检查 500 条原始行，大小写折叠匹配后返回与历史相同的 `id/ref_seq/role/text` 和下一页游标。压缩摘要、内部提示及其他 Thread/branch 没有可见引用，不进入搜索；原始行缺失返回 409。归档不移除搜索、历史、附件或已接收发送的幂等记录。
