# Side chat：从一条消息开始的子讨论

状态（2026-11-18）：需求已由 Jamie 确认。没有实现。

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
4. **显示方式。**
   - 桌面：side chat 在主窗口右侧的面板中打开。源 Thread 的时间线留在左边，两者同时可见。
   - 手机：屏幕宽度不够，side chat 全屏推入（原生 Stack），返回后回到源 Thread。
5. **桌面左侧边栏。** Side chat 显示在源 Thread 下一级。与 Recents 相同：显示全部运行中的 side chat 和最新的 10 条其他 side chat，每次 Show more 再加 10 条。

## 与 Branch 的区别

| 项目 | Branch | Side chat |
|---|---|---|
| 列表位置 | Channel 下的平级 Thread | 桌面：侧边栏中源 Thread 的下一级；手机：不出现在 Channel 的 Thread 列表中 |
| 打开方式 | 普通 Session 页面 | 桌面：右侧面板，与源 Thread 并排；手机：全屏推入 |
| 源 Thread 时间线 | 写入一条 `Branched to [...]` 系统提示 | 不写入任何消息；锚点消息上显示一个小标记 |
| 锚点 | 已完成一轮的最终回复 | 最终回复，或外部消息（例如 TG 原文行） |
| 源 Thread 运行中 | 返回 `busy` | 等待源 Thread 空闲后创建，用户不用重试 |
| 结论带回 | 无 | 手动 "Send to main" |
| 再分支 | 可以 | Side chat 内不提供 Side chat 和 Branch |

## 需求（Jamie 已确认，2026-11-18）

### 1. 创建

1. 在主 Thread 中，可作为锚点的消息的 toolbar 上有 **Side chat** 按钮。手机和桌面都有。
2. 可作为锚点的消息：
   - 已完成一轮的最终 assistant 回复。
   - 外部消息（`display_kind = external_message`，见插件仓库 `docs/external-messages.md`）。
3. 锚点必须在源 Thread 的当前 session 中。这条限制和 Branch 相同。
4. 源 Thread 运行中时，客户端照常发出请求。插件等待源 Thread 空闲，然后创建 side chat。按钮在等待期间显示进行中状态。
5. 创建完成后，客户端打开新的 side chat（桌面在右侧面板，手机全屏推入）。
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

### 4. 显示与导航

#### 桌面：右侧面板

1. Side chat 在 Session 页右侧的面板中打开。源 Thread 的时间线和输入框留在左边，两者同时可见、可以分别滚动和输入。
2. 面板包含 side chat 的完整时间线和它自己的输入框。时间线、发送、运行状态和 toolbar 的规则与普通 Session 页面相同。
3. 面板标题行显示 side chat 标题、一个返回源锚点的按钮（滚动主时间线到锚点并短暂标记）和关闭按钮。
4. 面板使用现有右侧栏（`browser-sidebar`）的位置和宽度规则：可以拖动宽度，宽度保存在本机；主时间线至少保留 360px。
5. 右侧栏用标签页同时保留多项：side chat 和浏览器/附件预览各是一个标签页。
   - 打开一项时，增加它的标签页（已打开则切换到它），不关闭其他标签页。
   - 切换标签页保留每项的状态（side chat 的阅读位置和草稿，浏览器的页面）。
   - 关闭一个标签页后，显示相邻的标签页；全部关闭后右侧栏关闭。
   - 浏览器是主进程定位的原生视图：它的标签页不在前台时，视图隐藏（`setBrowserBounds` 的 `visible: false`），不覆盖 side chat。
   - 同一 Session 页可同时打开多个 side chat 标签页。
6. 每个 Session 页（含标签页）各自记住面板打开的是哪个 side chat 及其阅读位置。切换标签页再回来，面板保持原状；关闭面板不删除 side chat。
7. 桌面左侧边栏在源 Thread 行的下一级列出它的 side chat：
   - 显示全部运行中的 side chat，再加最新活动的 10 条其他 side chat。每次 Show more 再加 10 条。规则与 Recents 相同（`RECENT_BATCH`，见 [desktop/tree-navigation.md](desktop/tree-navigation.md)）。
   - 排序：运行中的在前，其余按最新活动时间从新到旧。
   - 源 Thread 出现在 Project 树、Recents 或 Todo 中时，side chat 都显示在它下面，不作为独立的一行出现在这些列表的第一级。
   - 源 Thread 行有展开/折叠控件。默认展开，折叠状态保存在本机。
   - Side chat 行显示自己的未读和运行状态，样式与 Thread 行相同，多一级缩进。
   - 点 side chat 行：打开源 Thread 的 Session 页，side chat 在右侧面板中打开。
8. 用户也可以从锚点标记，或 Session 状态栏中的 "Side chats" 按钮打开 side chat。

#### 手机：全屏推入

1. Side chat 用 Expo Router 原生 Stack 全屏推入，返回手势和返回按钮回到源 Thread。
2. 返回后源 Thread 保留原阅读位置、草稿和历史窗口（见 [live-session-pages.md](live-session-pages.md)）。
3. Channel 的 Thread 列表不显示 side chat。用户从锚点标记，或源 Thread 的 Session options 中的 "Side chats" 列表进入。

#### 两端相同

1. 标题默认为 `Side: <锚点开头文字>`，可以改名。
2. 归档源 Thread 时，它的 side chat 跟着隐藏。Side chat 也可以单独归档。

### 5. 手动带回结论（Send to main）

1. Side chat 中每条最终回复的 toolbar 上有 **Send to main** 按钮。
2. 点按钮后，客户端把以下内容放入源 Thread 的输入框，不自动发送。桌面上面板保持打开，焦点移到左边的输入框；手机返回源 Thread：

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
2. 等待空闲的最长时间是 10 分钟（已确认）。超时返回 `busy`，客户端用自然语言说明。实现时确认这个时长在真实 TG 话题上够用。
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
5. Mac：side chat 在右侧面板打开；主时间线和面板同时可见，各自滚动和输入；拖动宽度后重开仍保持；面板打开时主 Thread 来新消息，主时间线照常跟随。
6. Mac：从面板标题行回到锚点，主时间线滚到锚点并标记；切换标签页再回来，面板保持原 side chat 和阅读位置。
7. iPhone：side chat 全屏推入，返回手势回到源 Thread，阅读位置和草稿不变。
8. Mac：侧边栏中 side chat 在源 Thread 下一级；创建 12 条以上时，显示运行中的加最新 10 条，Show more 再显示 10 条；点一条，源 Thread 打开，side chat 在右侧面板。
9. iPhone：Channel 列表不显示 side chat。
10. 关闭 App 再打开：side chat、锚点标记和未读状态一致。
