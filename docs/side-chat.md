# Side chat：从一条消息开始的子讨论

状态（2026-11-18）：需求已由 Jamie 确认。插件 v0.2.68 已发布。客户端：共享 client、桌面和手机已发布（桌面 v0.1.146，iOS 更新 `774eea4d`）。

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

## 架构（插件已实现，未发布）

继续使用核心原生 `/branch`。不修改 Hermes 核心。插件分支 `feat/side-chat`（`/opt/projects/jamie/_worktrees/hermes-app-plugin/side-chat`）。

1. **插件接口。** `POST /v1/threads/{id}/branch` 增加 `kind`，取值 `branch`（默认，行为不变）或 `side`。
   - `kind = side`：先同步检查锚点和来源。锚点无效时立即返回 409（`anchor_not_final`、`anchor_unavailable`）；来源本身是 side chat 时返回 409 `side_unavailable`。
   - 检查通过后返回 `202 {state: "running"}`，由后台任务创建。客户端用同一 `request_id` 重复请求（建议每秒一次），直到返回 `200 {thread}` 或 409 `{error}`。
   - 后台任务每秒检查一次来源是否空闲，空闲后在该 Thread 的 ingress 锁内执行 `/branch`。最长等待 10 分钟，超时结束为 `busy`。等待期间不占用 ingress 锁，所以主 Thread 照常收发消息。
   - 同一 `request_id` 换 `kind` 请求返回 400。
2. **存储。** 新表 `side_chats(thread_id, source_thread_id, anchor_seq, anchor_text)`，与 Thread 在同一事务中写入；`branches` 增加 `kind` 列（默认 `branch`）。都是新增结构，旧版本插件回滚后把 side chat 显示为普通 Thread。
3. **目录与锚点标记。** Catalogue 行（`/v1/catalogue`、`/v1/catalogue/threads`）和 `GET /v1/threads/{id}` 的 side chat 带 `side_of: {thread_id, anchor_ref_seq}`；普通 Thread 没有这个字段。客户端用 catalogue 计算锚点标记、侧边栏层级和 Session options 列表，不另设 `/sides` 接口。Side chat 的变化沿用现有 `directory_changed`。
4. **时间线。** Side chat 只发布一条顶部提示：`Side chat from [<源标题>](hermesapp://session/<源 id>): “<锚点开头>”`（`notice_kind` 为 `branch`）。复制的历史不发布，只作模型上下文；复制的用户输入的附件授权照常写入。源 Thread 不写任何提示。
5. **让模型知道锚点。** Side chat 第一轮（还没有 assistant 回复时），`pre_llm_call` hook 返回一段上下文：来源标题、锚点原文（最多 4000 字），并说明这是 side chat、源对话的后续消息不在其中、不要在 side chat 中向外部聊天发消息（除非用户在这里明确要求）。核心把它写入这一轮的 `api_content`，后续各轮原样重放；它不显示在时间线中。
6. **截断与合并行。** 核心加载 transcript 时，把相邻的纯文本 assistant 行合并成一行（`_merge_consecutive_assistants`：去掉首尾空白，用换行连接，用第一行的时间戳），`/branch` 复制的是合并结果。插件的行对应规则已包含这种合并，与已有的相邻 user 行合并规则相同。截断点必须是锚点之后第一条 user 行，或单独复制的外部消息行。
7. **能力。** `capabilities.thread_side: true`。没有这个能力时，客户端不显示 Side chat 按钮。
8. **标题。** `Side: <锚点第一行，最多 60 字>`。

## 客户端实现（分支 `feat/side-chat`，未发布）

### 共享 client（`packages/client`）

1. 能力 `supportsThreadSide`：服务器同时报告 `thread_branch` 和 `thread_side` 时为 true。
2. `sideThread(threadId, anchorRefSeq, requestId)`：`POST /branch`（`kind: side`）。服务器返回 202 `{state: "running"}` 时，每秒用同一 `request_id` 重发，直到返回 Thread 或 409。返回的 Thread 必须带 `side_of`，且指向请求的源 Thread 和锚点。本地最长等 11 分钟（服务器 10 分钟后自己返回 `busy`）。
3. `side_of` 在 `GET /v1/threads/{id}`、catalogue 行和 live client 的精简目录行中都保留。格式错误的 `side_of` 按协议错误处理。
4. `sideChats.ts`：按源 Thread 分组（运行中在前，再按最新活动）、按锚点分组、侧边栏窗口（全部运行中 + 每批 10 条）、锚点标记文字（`Side chat`、`Side chat · N`）、Send to main 文字和失败提示。桌面和手机共用。

### 桌面

1. **右侧栏面板。** 每个 side chat 是一个独立的 `WebContentsView`（与 Session 标签页相同的安全设置），由 `tab-manager.ts` 管理，属于源 Session 的标签页，不出现在标签栏。
   - 面板页面就是普通 Session 页面（时间线、输入框、状态栏），快照带 `sidePanel: true`。面板页面隐藏时不销毁，所以阅读位置和草稿保留。
   - 右侧栏的前台项是 `rightTab`：`browser` 或一个面板 ID。浏览器打开时到前台；浏览器关闭或前台面板关闭时，显示相邻的一项。面板在前台时，浏览器页面用 `layout(..., false)` 隐藏。
   - 主窗口渲染右侧栏的标签行（浏览器 + 各 side chat，带运行/未读点和关闭按钮）和面板标题行（标题、回到锚点、关闭），面板位置通过 `setSidePanelBounds` 发给主进程。宽度沿用浏览器栏的宽度规则（`browser-width.ts`）。
   - 面板里的操作（发送、上传、草稿、已读）都以面板自己的 side chat 为目标（`tabs.target`）；附件预览和链接用源标签页的浏览器（`browserOwner`）。面板中的 Cmd+W 关闭面板。
2. **打开方式。** 锚点标记、状态栏的 Side chats 按钮、侧边栏的 side chat 行都调用 `openSideChat`：在源 Session 的标签页（没有则新建）右侧栏打开。链接或搜索选中一个 side chat 时，`sync` 同样改为在源标签页右侧栏打开，不新建标签页。源 Session 不在目录中（已归档）时，side chat 按普通 Session 打开。
3. **创建。** 消息 toolbar 的 Side chat 按钮调用 `desktop:side-message`。等待期间不把标签页标为忙，用户可以继续在源 Session 输入；按钮显示进行中，源 Session 运行中时提示"Opens when the current reply finishes…"。成功后在发起的标签页打开面板。
4. **锚点标记。** 源 Session 时间线中，有 side chat 的消息下方显示 `Side chat` 或 `Side chat · N`，带运行和未读点。一个直接打开；多个时显示原生菜单。
5. **Send to main。** 面板中最终回复的 toolbar 有 Send to main。主进程从 side chat 的消息生成文字（`sendToMainText`），发到源标签页（`desktop:fill-composer`）；源输入框把它接在已有草稿后面，焦点移到源输入框末尾，不发送。
6. **侧边栏。** Side chat 不作为第一级行。源 Session 行的标题与其他行对齐；折叠按钮在该行右端，悬停或聚焦时显示，折叠时一直显示并带 side chat 数量（默认展开，折叠的源 ID 保存在 `localStorage` 的 `hermes.sidebar.side-chats-collapsed`）。下面一级列出 side chat：标题比源标题右移一档（17px，与 Project 下的 Session 相同），竖线在源标题下方，行前有 side chat 图标，行高稍矮，字号和文字颜色不变；运行中的全部显示，其他每批 10 条（Show more）。源已归档时，它的 side chat 不显示。右侧栏前台的 side chat 行显示为选中。
7. Side chat 页面没有 Branch 和 Side chat 按钮，也不显示锚点标记和 Side chats 按钮。

### 手机

1. **列表。** Channel 的 Thread 列表、Recents、Todo 和搜索都不列出 side chat（`side_of`）。Project 的未读数也不计 side chat，因为手机列表里没有这些行。
2. **创建。** 最终回复的 toolbar 有 Side chat 按钮（服务器有 `thread_side`，且当前 Session 不是 side chat）。源 Session 运行中时按钮照常可用，显示进行中，服务器空闲后创建；创建后用 Session 导航全屏推入 side chat。同一消息在服务器明确回答前使用同一个 `request_id`。
3. **锚点标记。** 有 side chat 的消息下方显示 `Side chat` 或 `Side chat · N`，带运行和未读点。一个直接推入；多个时 iOS 显示 Action Sheet，Android 显示前两个和 "All side chats"（打开 Session options）。
4. **Session options。** 源 Session 显示 "Side chats" 一节（运行中在前，再按最新活动；已归档的不显示）。Side chat 显示 "Side chat" 一节，其中 "Source session" 回到源 Session。
5. **Send to main。** Side chat 中最终回复的 toolbar 有 Send to main，没有 Branch 和 Side chat。点按后，文字接在源 Session 的草稿后面（`composerFill.ts`：已挂载的源页面立即收到；未挂载时保存在草稿中），然后用 Session 导航回到源 Session（它在 Stack 中时返回，阅读位置和草稿保留）。不发送。

### 测试（本机，2026-11-18）

- `npm run client:check`：161 passed（新增 `packages/client/tests/side-chat.test.mjs`，8 项）。
- `apps/desktop/tests/native-tabs.test.mjs`：14 passed（新增 4 项：打开/隐藏/恢复、多个面板与浏览器、链接改向与归档/关标签页、Send to main 与回到锚点、Cmd+W）。
- `apps/desktop/tests/side-chat-ui.test.mjs`（Chromium）：Session 页面按钮和锚点标记、运行中的按钮状态、Send to main 接草稿、面板页面 toolbar、右侧栏标签和位置、侧边栏层级、Show more、折叠保存、归档源隐藏。
- `apps/desktop/tests/side-chat-native.test.mjs`（Electron + Xvfb，生产主进程/preload/渲染器，受控 client）：锚点标记打开面板；面板和 Session 并排（1400 宽窗口：Session 560px，面板 554px，不重叠）；两个输入框各发到自己的 Session；Send to main 预填、不发送；回到锚点标记源消息；Side chat 按钮请求 `(源, 4, sc_…)` 并在前台打开第二个面板；切换标签页保留页面；关闭面板；侧边栏行重新打开。
- 完整桌面套件：333 项中 324 passed、9 failed。8 项（`composer-focus-width`、`font-settings`、`full-history-loading`、`session-auto-bottom`、`session-message-focus`、`settings-focus`、`settings-layout`、`tab-status` 中的 Chromium 测试）在未改动的 `origin/main` 上同样失败；1 项（`native-electron`）在负载下失败，单独重跑通过。
- 未做：Jamie 的 Mac 上看实际效果；真实服务器上的端到端操作。

## 已知限制

1. **与锚点一起到达的外部消息。** 一个最终回复和它后面连续到达的外部消息（中间没有 user 行），在模型上下文中是同一条 assistant 消息。从其中任何一条打开 side chat，上下文都包含这一组的全部消息，到下一条 user 行为止。插件不改写核心的行。第 5 项的锚点说明告诉模型具体从哪条开始。
   - TG 话题中，新消息通常立即触发 `⟳ 自动回复` 一轮（user 行），所以一组通常只有一两条。
2. **Branch 的同类情况。** 以前，从后面跟着外部消息的最终回复做 Branch 会返回 `history_mismatch`。现在可以 Branch，但新 Thread 中这一组显示为一条合并后的消息。
3. 锚点必须在源 Thread 的当前 session 中，与 Branch 相同。

## 验收

### 插件测试（真实 GatewayRunner + HTTP API）

1. 从最终回复创建 side chat：新 Thread 带 `side_of`；模型上下文截到锚点；源 Thread 没有新增消息或系统提示。
2. 从外部消息创建 side chat，锚点后紧跟另一条外部消息：不返回 `history_mismatch` 或 `anchor_not_turn_end`；上下文符合「已知限制」第 1 项；第一轮上下文中有锚点原文。
3. 源 Thread 运行中请求：返回 `202 {state: "running"}`；运行结束后同一 `request_id` 返回新 Thread；不重复创建。
4. Gateway 在等待或创建中重启：请求结束为失败，不留下半成品 Thread，源 Thread 不变。
5. Side chat 中的新消息不进入源 Thread 的 transcript，源 Thread 的新消息不进入 side chat。
6. `kind` 缺省时，Branch 的全部现有测试仍通过。

状态（2026-11-18，插件 `feat/side-chat` `ec4dbbe`，核心 `272c0ccea4`，Python 3.14 运行时环境）：

- 第 1、2、3、5、6 项通过：`tests/p1/side_chat_probe.py`（真实 GatewayRunner、HTTP API、本地合成模型），另含：同一 `request_id` 幂等、换 `kind` 返回 400、side chat 内再开 side chat 返回 `side_unavailable`、无效锚点立即返回且不创建 Thread、第一轮锚点上下文只出现一次且不显示、从后面跟着外部消息的最终回复做 Branch。
- 第 4 项（等待或创建中 Gateway 重启）没有专门测试。代码路径：停止时取消后台任务并记为 `interrupted`，已创建的 Thread 归档；启动时 `branch_recover` 把残留的 `running` 记为失败。
- 完整 P1 套件：分支 428 passed、4 failed；未改的 `main` 426 passed、3 failed。三项在两边都失败；只在分支上失败的 `test_runner.py::test_preflight_repeated_after_settlement` 重跑 3 次在分支上都通过，在 `main` 上 1 次失败，是不稳定测试。

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

## 发布记录

- 2026-11-18（Jamie「合并发布」）：插件 v0.2.68。
  - 插件 `main` `975bf04`（功能 `ec4dbbe`），tag `v0.2.68`，已推送。`current` 从 `releases/0.2.67` 切到 `releases/0.2.68`（与 `git archive v0.2.68` 相同）；emma、hermes-app-dev、jamie、nan、space、wangyu 都指向它。
  - 数据结构：新表 `side_chats`，`branches` 增加 `kind` 列，Gateway 启动时自动加。在六个 profile 的 `metadata.sqlite` 副本上检查：只增加 `side_chats`，行数不变，重复执行无变化；旧版 v0.2.67 代码在迁移后的库上可以读 Thread、写 Branch。代码回滚不需要恢复数据。切换前的在线备份在 `~/.hermes/profiles/jamie/workspace/hermes-app/20261118-side-chat/db-backups/`。
  - 客户端：本次没有客户端改动（Side chat 按钮、右侧面板、侧边栏层级、手机推入、Send to main 都没有实现）。旧客户端不能创建 side chat，也不显示 `side_of`。
  - 生效条件：Jamie 重启 `hermes-gateway.service`。重启前 Gateway 运行 v0.2.67（启动于 2026-11-18 14:08:34 PST）。
  - 回滚：`current` 切回 `releases/0.2.67`，再重启 Gateway。
  - 重启后检查（2026-11-18 20:08:35 PST 启动，PID 3739552）：六个 profile 都有 `side_chats` 和 `branches.kind`，`integrity_check` ok，无外键错误，Thread 数不变。jamie（9791）和 hermes-app-dev（9790）的 capabilities：无 token 401，有 token 200，`thread_side: true`。在 hermes-app-dev 的临时 Thread 上用真实模型实测：源 Thread 回复 `PROBE-ALPHA`，从它创建 side chat（轮询 1 次后就绪，标题 `Side: PROBE-ALPHA`，`side_of` 正确，同一 `request_id` 再请求返回同一 Thread），side chat 时间线只有顶部提示；在 side chat 中问"起点消息是什么"，模型回答 `PROBE-ALPHA`；源 Thread 前后不变。临时 Thread 已归档。新进程日志中没有 side chat 或 branch 错误。

### 客户端发布记录（2026-11-18）

- **App 仓库：** `main` = tag `v0.1.146` = `05110f8`（功能提交 `da79019` client、`7d038a7` desktop、`a228379` mobile）。服务器需要插件 v0.2.68（`thread_side`）；旧服务器上不显示 Side chat。
- **桌面：** Mac mini 用 `scripts/macmini-desktop-release.sh v0.1.146` 构建并发布 Release（`Hermes-0.1.146-macOS-arm64.dmg` + `.sha256`，非草稿）。签名：`Authority=Developer ID Application: Nan Zhang (4R5932XFRV)`，`source=Notarized Developer ID`，DMG notarytool `48219fb0-8535-40a4-8671-0594c9c5583f` `Accepted`，stapler `The validate action worked!`。10 个 `App code SHA-256` 与在 tag 处干净 worktree 的 `npm ci` + `npm run build` 结果全部一致；DMG `sha256sum -c` OK；标记 `desktop:side-message`、`tree-side-toggle` 各 1。
- **Expo（Expo Go 入口）：** 运行目录 `d6f9396` → `05110f8`，`hermes-app-expo.service` PID 3649280 → 3810249（20:53:08 PST）。公开 bundle 标记：iOS `Source session` 0→1、`sideChatsByAnchor` 0→6；Android `Source session` 0→1、`All side chats` 0→1、`sideChatsByAnchor` 0→6（`All side chats` 只在 Android 分支）。Gateway PID 3739552 不变，插件哈希不变。
- **iOS（TestFlight 安装包）：** 没有新的 TestFlight 构建，build number 不变。签名 OTA 更新 `774eea4d-dcde-42d8-b89e-8ca0812677cd`（runtime `b32a4b59…`，commit `05110f8`）；manifest 200，bundle 13913026 字节，含新代码。已安装的 App 下次冷启动下载。
- **回滚：** 桌面装回 v0.1.145；Expo 运行目录回到分支 `rollback/side-chat-before-release`（`d6f9396`）后重启 Expo；iOS `publish.mjs rollback --platform ios --runtime b32a4b59c09764da6bb60618bb3513d46fe43d86 --to 4cc63529-44d5-4bf3-bc19-bbc6792edd35`；代码 `git revert` 上述功能提交。
- **未完成：** Jamie 在 Mac 和 iPhone 上的实际检查；iPhone 收到更新的日志证据（`current=774eea4d`）。

## 桌面侧边栏对齐发布（v0.1.148，2026-11-22）

- 提交 `a1fe92e`（侧边栏对齐）、`8df553b`（版本号），tag `v0.1.148`。
- 改动：源 Session 标题与其他行对齐（旧版 69px，其他行 51px）；折叠按钮移到行右端，折叠时显示数量；side chat 标题比源标题右移一档（旧版反而左移 4px），行前有 side chat 图标，行高稍矮；字号和文字颜色不变（Jamie 要求）。
- 验证：`tests/side-chat-ui.test.mjs`（真实 Chromium）和 `tests/side-chat-native.test.mjs`（Electron/Xvfb）通过；新的布局断言在旧代码上失败。整套桌面测试中另有 8 个 Chromium 测试失败，未改动的源码同样失败，与本改动无关。
- 发布：Mac mini 构建，Developer ID 签名、公证并 staple。第一次公证因连接 Apple 超时失败，重试通过。取回文件时 `scp` 断开，改用 `rsync --partial` 取回并校验 SHA-256，再用 `--publish-built` 发布。GitHub Release `v0.1.148` 为 Latest，只有 DMG 和 `.sha256`；更新 feed 对 0.1.147 返回 200（0.1.148），对 0.1.148 返回 204。安装包中 `renderer/styles.css` 的 SHA-256 与本地同一提交的构建一致（`bbaf707b…`）。
- 待验收：Jamie 的 Mac 上查看 Recents 和 Project 中带 side chat 的 Session。
