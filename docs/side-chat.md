# Side chat：从一条消息开始的子讨论

状态（2026-11-18）：需求与验收草案。没有实现。

## 目的

一些 Thread 的消息流很密集，例如 tg-userbot 的 TG 群话题：每条 TG 原文、`⟳ 自动回复` 和拟回复都在同一时间线里。用户要对其中一条深入讨论时，讨论内容会打断主消息流。

Side chat 解决这个问题：

- 用户从主 Thread 的一条消息打开 side chat。
- Side chat 继承这条消息及之前的上下文。
- Side chat 里的讨论不进入主 Thread 的时间线，也不进入主 Thread 的模型上下文。
- 讨论出结论后，由用户手动把结论带回主 Thread。

## 已确认的产品决定（Jamie，2026-11-18）

1. **上下文只用快照。** Side chat 的上下文是锚点消息及之前的主 Thread 原文。之后主 Thread 的新消息不进入 side chat，不提供"同步最新消息"。
2. **结论由用户手动带回。** 不自动生成摘要，不自动写入主 Thread。
3. **Branch 和 Side chat 都保留。**
   - Branch：独立的平级 Thread，规则见 [thread-branch.md](thread-branch.md)，不变。
   - Side chat：附属于源 Thread 和锚点消息的子讨论。

## 与 Branch 的区别

| 项目 | Branch | Side chat |
|---|---|---|
| 列表位置 | Channel 下的平级 Thread | 源 Thread 下的子项，不出现在 Channel 的 Thread 列表中 |
| 源 Thread 时间线 | 写入一条 `Branched to [...]` 系统提示 | 不写入任何消息；锚点消息上显示一个小标记 |
| 锚点 | 已完成一轮的最终回复 | 最终回复，或外部消息（例如 TG 原文行） |
| 源 Thread 运行中 | 返回 `busy` | 等待源 Thread 空闲后创建，用户不用重试 |
| 结论带回 | 无 | 手动 "Send to main" |
| 再分支 | 可以 | Side chat 内不提供 Side chat 和 Branch |

## 需求（建议，除上面三项外待 Jamie 确认）

### 1. 创建

1. 在主 Thread 中，可作为锚点的消息的 toolbar 上有 **Side chat** 按钮。手机和桌面都有。
2. 可作为锚点的消息：
   - 已完成一轮的最终 assistant 回复。
   - 外部消息（`display_kind = external_message`，见插件仓库 `docs/external-messages.md`）。
3. 锚点必须在源 Thread 的当前 session 中。这条限制和 Branch 相同。
4. 源 Thread 运行中时，客户端照常发出请求。插件等待源 Thread 空闲，然后创建 side chat。按钮在等待期间显示进行中状态。
5. 创建完成后，客户端打开新的 side chat。
6. 同一锚点可以打开多个 side chat。

### 2. 上下文

1. Side chat 的模型上下文是核心 `/branch` 复制的 transcript，截到锚点消息为止。这一点和 Branch 相同。
2. Side chat 使用源 Thread 所在 Channel 的 Description。这一点和 Branch 相同。
3. 创建之后，主 Thread 的新消息不进入 side chat。
4. Side chat 时间线顶部显示一条提示，链接回源 Thread，并显示锚点消息的开头文字。
5. Side chat 不显示复制的历史。时间线从顶部提示开始。用户已经在主 Thread 看过这些历史。这一点与 Branch 不同，Branch 显示复制的完整历史。

### 3. 不污染主 Thread

1. 创建 side chat 不在源 Thread 写入系统提示、命令回复或回执。
2. 源 Thread 的锚点消息上显示一个小标记，例如 "Side chat · 2"。标记不是消息，不进入历史、搜索和导出。
3. 点标记打开 side chat。锚点有多个 side chat 时，先显示一个列表。
4. Side chat 的未读和运行状态显示在 side chat 自己的条目上，不改变源 Thread 的未读状态。

### 4. 列表与导航

1. 桌面：side chat 显示在侧边栏中源 Thread 的下一级，可以折叠。
2. 手机：Channel 的 Thread 列表不显示 side chat。用户从锚点标记，或源 Thread 的 Session options 中的 "Side chats" 列表进入。
3. 标题默认为 `Side: <锚点开头文字>`，可以改名。
4. 归档源 Thread 时，它的 side chat 跟着隐藏。Side chat 也可以单独归档。

### 5. 手动带回结论（Send to main）

1. Side chat 中每条最终回复的 toolbar 上有 **Send to main** 按钮。
2. 点按钮后，客户端打开源 Thread，把以下内容放入输入框，不自动发送：

   ```text
   From side chat [<side chat 标题>](hermesapp://session/<side-thread-id>):

   <这条回复的正文>
   ```

3. 用户可以编辑，然后用正常发送路径发送。源 Thread 运行中时，沿用现有的发送、插入和排队规则。
4. 预填内容不能以 `>>` 开头。tg-userbot 话题中，`>>` 表示直接发到 TG。

### 6. 外部聊天的安全

1. Side chat 不绑定外部聊天。tg-userbot 的 `bridge_threads` 只记录源 Thread，所以 TG 新消息不写入 side chat。
2. 在 side chat 中输入 `>>` 不发到 TG。
3. 对外发送在主 Thread 中进行。Side chat 用于讨论和拟稿。

## 架构草案（建议，待实现时确认）

继续使用核心原生 `/branch`。不修改 Hermes 核心。

1. **插件接口。** `POST /v1/threads/{id}/branch` 增加 `kind`，取值 `branch`（默认）或 `side`。`request_id` 幂等不变。
   - `kind = side` 且源 Thread 运行中：返回 `202 {state: "waiting"}`。插件在源 Thread 空闲后执行 `/branch`。客户端用同一 `request_id` 重新请求，直到返回新 Thread 或错误。
   - 不在 HTTP 请求中长时间等待，因为 Cloudflare 有请求时长上限。
2. **存储。** `branches` 表增加 `kind` 列。Side chat 的 Thread JSON 增加 `side_of: {thread_id, anchor_ref_seq}`。
3. **锚点标记。** 新增 `GET /v1/threads/{id}/sides`，返回 side chat 列表（`thread_id`、`anchor_ref_seq`、标题、最后活动时间）。变化时发出同步事件。历史分页的消息格式不变。
4. **截断规则。** 现有 `truncation_target` 要求锚点后第一行是 user 行。TG 话题中，锚点后常常是另一条外部消息。`kind = side` 时，截断点是锚点后第一条完整消息的开头：一条 user 行，或一条外部消息行。截断点不能落在工具调用和工具结果之间。
5. **源 Thread 提示。** `kind = side` 时不调用 `create_system_notice`。
6. **能力。** `capabilities` 增加 `thread_side: true`。服务端没有这个能力时，客户端不显示 Side chat 按钮。
7. **客户端。** Send to main 只在客户端实现，使用现有输入框和发送路径。

## 待实现时验证的事实

1. 外部消息作为锚点时，现有检查（`anchor_not_final`、`history_page` 的 `display_kind`）是否拒绝它。代码阅读显示可能拒绝，需要在真实 TG 话题上确认。
2. 等待空闲的最长时间。建议 10 分钟；超时返回 `busy`，客户端用自然语言说明。
3. 复制的历史较长时（例如数百行），创建 side chat 的耗时。

## 验收

### 插件测试（真实 GatewayRunner + HTTP API）

1. 从最终回复创建 side chat：新 Thread 带 `side_of`；模型上下文截到锚点；源 Thread 没有新增消息或系统提示。
2. 从外部消息创建 side chat，锚点后紧跟另一条外部消息：截断正确，不返回 `anchor_not_turn_end`。
3. 源 Thread 运行中请求：返回 `202 waiting`；运行结束后同一 `request_id` 返回新 Thread；不重复创建。
4. Gateway 在等待或创建中重启：请求结束为失败，不留下半成品 Thread，源 Thread 不变。
5. Side chat 中的新消息不进入源 Thread 的 transcript，源 Thread 的新消息不进入 side chat。
6. `kind` 缺省时，Branch 的全部现有测试仍通过。

### 真实设备（iPhone 和 Mac，jamie 连接）

1. 在 [TG · core team](hermesapp://session/th_tgdc0b91c7e57040b122ab10a3) 中，从一条 TG 原文行打开 side chat，讨论两轮。主 Thread 时间线不变，锚点显示标记。
2. 自动回复运行中点 Side chat：不报错，空闲后自动打开。
3. 在 side chat 中点 Send to main：源 Thread 输入框有预填内容，编辑后发送；TG 不收到这条消息，除非用户另外指示发送。
4. 在 side chat 中输入 `>> 测试`：TG 不收到。
5. 桌面侧边栏中 side chat 在源 Thread 下；手机 Channel 列表不显示 side chat。
6. 关闭 App 再打开：side chat、锚点标记和未读状态一致。
