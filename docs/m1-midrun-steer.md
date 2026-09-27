# M1 运行中发送：对齐 Discord 的原生 Gateway 路径（固定核心，隔离插件候选）

**修正结论：插件方案可行；不需要核心新增逐条 exactly-once 消费 API。** 目标是 Discord 同级的“运行中输入交给 Gateway 原生 steer，失败/边界由 Gateway 回退”，而非把 App 现有 FIFO 说成 steer。固定核心 `/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline` 只读；本工作树的插件候选已改，运行服务及实际 profile 配置未改。崩溃歧义沿用 App 的 `unknown`、不自动重放；**不能把持久 202 或 Gateway 的暂收当作模型已消费证明**。

## 实际路径和证据

- Discord `plugins/platforms/discord/adapter.py:1520-1524,6128-6149`：入站先鉴权、去重、线程路由，保留 Discord 原始 `message_id`，构造 `MessageEvent(text, source, message_id, media…)`，文本可先 debounce，然后 `await self.handle_message(event)`；并未在 Discord adapter 手调 `agent.steer()`。
- `gateway/platforms/base.py:3890-3930,3932-3983`：同 session 的活动 guard 使第二条进入 `_handle_message_while_active`，先处理停止/审批/澄清的特殊路径，再交 runner busy handler。`gateway/run_busy.py:789-865`：在有效 `display.busy_input_mode=steer` 下，纯文本由 `_resolve_busy_steer_or_redirect` → `running_agent.steer()`，失败由核心 FIFO 回退；非语音附件不 steer。正式 `/steer` 命令也可调用相同原语（`:1028-1062`），但照搬 Discord 普通发送**不需要把用户正文改写成 slash 命令**。
- 文档 `website/docs/user-guide/messaging/index.md:430-447` 与 `gateway/run_config_loaders.py:244-274,330-369`：默认是 `interrupt`（**不是** steer），按路由 profile 快照读 `display.busy_input_mode`，没有 platform-only 开关。可仅对已授权的**隔离 hermes-app-dev profile**设置 `steer`，但它如有其他平台也会同受影响；正式推广前须核实实际 profile 平台清单，不触碰 Jamie/默认 profile，不用私有 runner 属性覆盖。
- 当前 App `adapter.py:394-529` 的 HTTP 202 先 `Store.accept` 持久排队，而 `_queue_loop` 对 Thread 先 `claim_next`、等待这个 Gateway owner 完成再取下一个。`storage.py:274-285` 禁止并发 running。同 Thread 下一条**从未在原 owner 活着时调用 `handle_message`**；因此目前 App 一定无法进入上述 Discord busy 路径。`event._gateway_accepted` 在成功 steer 的 busy 分支仍为 `False`（实测），不能用它推断失败。

## 原始可行性实验（实施前）

`tests/p1/test_steer_feasibility.py` 复用现有 `runner_probe.py` 的真实插件管理器、`GatewayRunner`、隔离 HOME、本地合成 OpenAI 接口和受控阻塞工具；仅在临时脚本/临时 profile 加 `display.busy_input_mode: steer`。在第一条 `P1_TIMELINE` 正在阻塞工具时，模拟 Discord 的 `MessageEvent` 直接连续交给 App adapter 的 `handle_message`，ID 分别 `native-steer-id-A/B`。结果：两条完整原文出现在**同一次下一轮模型 HTTP 请求**，工具未中断；核心 `state.db` 追加**一条** `role=user, display_kind=steer` 行，包含 Gateway 生成的两段 origin JSON（各含相应 message_id）和原文，两段 ID/正文顺序稳定；该行 `platform_message_id=NULL`。这是 native steer 的正例，不是旧的仅 FIFO timeline 测试。测试打印 `native_busy_steer: 2 IDs, 1 aggregated steer row...`，`1 passed`。实验未为第二、三条创建 App receipts：证明**运行机制**而非已完成 App 接线/崩溃验收。

历史实测（实施前）：原 App 历史仍仅有原运行的 `P1_TIMELINE` 用户行、工具助手行和最终助手行；聚合的 steer 核心行不在 App `message_refs`。当前隔离候选为每条已领取的原始输入分配单独、稳定的插件历史引用，不把聚合 steer 核心行当作额外用户消息；不能拿最终回复或命令 ack 冒充原始补充消息。

## 本地实现契约（仅隔离候选，未部署）

- HTTP 提交始终先持久 `accept`；运行中、路由 profile 的有效 `display.busy_input_mode=steer` 时，纯文本 FIFO 队首才原子领取并以原始 `MessageEvent(text, source, message_id=receipt.id)` 送入 `Base.handle_message`。每次 busy 派发取尽当前可领取的 FIFO 文本前缀；主 owner 已被领取但 `_active_receipts` 尚未安装时接收的消息，会在主消息建立 Gateway guard 后再次取尽，不依赖另一次 POST 唤醒。默认 `interrupt` profile 保持原有插件 FIFO；附件不插入，不越过前面的附件。没有 `/steer` 重写、直接 `agent.steer()`、核心写入或私有 monkeypatch。配置只在隔离 runner 测试 profile 打开，开发服务与其他 profile 未改。
- `GET /v1/capabilities` 的 `execution_ingress` 为 `durable_fifo_native_steer`（支持能力，不承诺当前 profile 已启用 steer），protocol 仍为 1；旧消费者不应据此自行重试已受理输入。
- 收据新增终态 `received`，仅意为当前进程已把运行中输入交给 Gateway，**不代表模型逐 ID 消费或完成**。忙时领取后为 `running`，对外附加可选 `admission:'followup'`（HTTP 202、精确 `/v1/receipts/{id}`、snapshot.active_receipts 均相同）；本轮结束且无核心普通 owner/待处理队列时转 `received+followup`。同 ID 重试返回原状态，不二次派发。只有核心 `platform_message_id=receipt.id` 的独立正常 user 行可以清除 marker；它代表实际转普通 turn：正式完成引用与真实 final 判 `completed`，已引用的失败/中断/未知 turn 保留其实际结果，只有 anchor 而无可信终态则 `unknown`，不误称 `received`。成功 native steer 的 `_gateway_accepted=False` 不重排或重试；主轮结束**不能**把 followup 判为 `completed`。已派发但崩溃、转交异常则转 `unknown`，不自动重放；无独立核心锚点的 followup `pending_text` 原文仍存插件数据库。
- 客户端反应设计：`running/received + admission:followup` 显示 👀 已接收；`queued` 才是 ⏳ 排队中；独立正常 owner 的 `running` 为 ⚙️；`unknown/failed/interrupted` 保持真实警示，**不把所有 unknown 当已接收**。父任务负责 SDK/mobile 消费此可选字段及新终态。每条忙时输入在交给 Gateway 前原子分配单独 `message_refs.seq`；历史消息 ID 为 `receipt:<receipt_id>`，正文来自对应持久 `pending_text`，附精确 `receipt_id/client_message_id/ref_seq`。正式 hook 和 owner 对账不再发布聚合 `display_kind=steer` 用户行，避免重复；不解析它的正文判断身份或模型消费。正常回退只有在 `platform_message_id=receipt.id` 的可读核心用户行出现后才将引用原位提升并原子清理暂存正文，保持 ID、顺序、读标记和分页游标不变。固定核心仍无逐 ID 消费证明；`received` 只表示 Gateway 暂收。
- 实际验证：`tests/p1/test_steer_feasibility.py` 在真实 GatewayRunner 阻塞工具时 HTTP POST 两次，同一次下一模型请求接收两条原文；API 历史按顺序出现两条独立原文，聚合 steer 核心行不重复显示。停止发生在模型消费前且没有对应核心行时，原文在历史与重新打开的 Store 中仍可读，同 ID 重试不重发；附件按原路径完成。`test_delivery_store.py` 验证原子 FIFO、附件阻断、崩溃转 unknown、历史/latest/分页/搜索/未读/读标记、旧引用表迁移、不可读核心行不清原文与精确正常锚点原位替换。完整 `tests/p1`（固定核心隔离 venv）**135 passed, 7 warnings**。**尚无确定性的真实 runner agent 尚未启动时 FIFO 回退窗口和跨进程 steer 崩溃重启用例**；不将存储级恢复实验冒充这两个端到端证明。

**客户端衔接（父任务负责）**：只按 `receipt_id/client_message_id` 和 `ref_seq` 合并 `receipt:<id>` 历史与本地乐观消息，不按正文或聚合 steer 文本猜测。Gateway `received+followup` 不保证 core 消费；现在服务端独立历史原文即使无核心行也保留并能跨设备读取。同步窗口尚未返回该引用之前，客户端仍须保留自己的乐观原文，不能仅凭 `received` 隐藏。

## 原始设计诊断（下列 unknown 建议已被上方 received 契约取代）

1. `accept` 仍先按 `client_message_id` 幂等提交每条正文/附件/receipt，HTTP 202 仅表示持久接收。对同 Thread 活动 owner 中、纯文本且适用 `steer` 配置的**下一条**，原子领取 receipt 由 queued 改为 running、持久记录 followup；不要复用 `claim_next` 的“只允许一个 running”判断，也不要让 FIFO worker 同时再取它。先查是否存在更早的 queued 项，不越序。对附件、审批答复/澄清、停止保持各自既有路径；不能把附件作为普通文本 steer。
2. 立即构造与 Discord 同型的原始 `MessageEvent(text=原文, source=同 Thread, message_id=receipt.id, media=[])`，`await adapter.handle_message(event)`。保持 `allow_gateway_control` 的正常命令/澄清语义，勿设 `internal`、勿拼 `/steer`、勿直连 agent、勿写核心历史。忙时进核心 steer；从忙转闲时 Base 可直接创建正常 Gateway owner；忙但尚无 agent 时核心可 FIFO 回退。忙处理返回值并不标示 steer 成功，所以一次提交后**不要靠 `_gateway_accepted=False` 重派或自动重放**。
3. 仅在确切普通 owner/核心行证据下追认独立完成；busy steer 的 receipt 不应拿主轮最终助手行作自己的 completion。核心 `display_kind=steer` 聚合行是**单一原生 steering 记录**，不伪造两个核心行。Gateway 生成的 origin JSON 在 `content` 内且多条聚合，**不是正式逐 ID provenance**，不以正文相似度/包含关系追认完成；健康 Gateway 转交后的终态是 `received`，而非模型完成。`unknown` 留给崩溃或转交异常。
4. 重启时已持久进入 running 的 steer 收据变 `unknown`，不再送；仍 queued 的才能照常调度。补测竞争：入口前/后崩溃、owner 刚结束时正常下一轮、Gateway agent 尚未启动时的原生 FIFO 回退、两 ID 聚合、附件不 steer、澄清与停止。`unknown` 允许用户自己决定是否重发，这是现有普通发送相同的 at-most-once/歧义契约。

**边界**：上述第 3 步若产品坚持每条 steer 都显示“已被模型读到/已完成”并有独立核心 user row ID，则固定核心确实没有这个信号；但这不是实现 Discord 式功能、保留原始 receipt 元数据和如实标注 `unknown` 的前置条件。候选已接线但未部署、未关卡 `t_6516f909`。
