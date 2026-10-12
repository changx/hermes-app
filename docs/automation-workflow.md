# Automation / Workflow 设计草案（v0，讨论稿）

状态：草案，未实现。创建与编辑界面的已确认设计见 [automation-editing.md](automation-editing.md)。

## 1. 目标

- 用户通过对话创建、试运行、修改和查看 workflow。
- 对话生成的是持久、带版本的结构化定义；执行依据定义，不依据聊天记录。
- 平台层（插件 + App）只负责：触发绑定、条目输出与落地、条目身份、Thread 状态、写操作关口。
- 业务逻辑（数据库查询、发信、权益更新、文章格式）全部放在 workflow 的 prompt、skill 和业务工具中。

## 2. 前提核查结果（2026-10-10，读取 ~/.hermes/hermes-agent 当前 local/main）

| 前提 | 结论 | 依据 |
|---|---|---|
| 插件工具在 cron 运行中能否拿到 job_id / execution_id | 能 | `cron/execution_identity.py`：ContextVar `CronExecution(job_id, job_name, execution_id, source, scheduled_instant, started_at, profile)`；插件通过 `ctx.current_cron_execution()` 读取；scheduler 用 `contextvars.copy_context()` 把它带进 agent 线程；delegate 子 agent 读到 `None` |
| cron 能否按 job 限制工具集 | 能 | `cron/scheduler.py::_resolve_cron_enabled_toolsets`：per-job `enabled_toolsets` 为白名单，`[]` 表示零工具；MCP server 默认会被并入，`no_mcp` 可排除；`_resolve_cron_disabled_toolsets` 始终禁用 `messaging`、`clarify`，默认禁用 `cronjob` |
| 插件能否强制拦截写工具 | 能 | `hermes_cli/plugins.py`：`pre_tool_call` hook 可返回 `{"action": "block", "message": ...}`；插件已注册该 hook |
| Resend 入站邮件 | 支持 webhook 与轮询 | webhook `email.received` 只含元数据，正文需调用 Received emails API；`GET /emails/receiving` 可列出收件；回复需设 `In-Reply-To`（可加 `References`）并以 `Re:` 开头的主题 |

Resend 来源页面：
- https://resend.com/docs/dashboard/receiving/create-receiving-webhook
- https://resend.com/docs/dashboard/receiving/reply-to-emails
- https://resend.com/docs/api-reference/emails/list-received-emails

结论：三项前提都可以在不修改 Hermes 核心的情况下满足。

## 3. Workflow 定义

插件存储，带版本号。调度引用核心 cron job，不另建调度器。

```yaml
id: wf_feedback_vxreels
version: 3
name: vxreels 用户反馈
enabled: true
trigger:
  kind: cron            # 以后：webhook、inbound_email、thread_status
  cron_job_id: <core cron job id>
  schedule: "*/15 * * * *"
collect:                # 阶段 1：无人值守
  prompt: <收集、核对用户信息、起草回复的指令>
  toolsets: [hermes_app_automation, vxreels_readonly]   # 写入 cron job 的 enabled_toolsets
output:
  mode: keyed           # append | per_run | per_item | keyed
  channel_id: <Feedback Channel>
  key_template: "{source}:{site}:{record_id}"
gate:                   # 阶段 2：人工审批后
  required: true
  actions_toolsets: [vxreels_write, resend_send]
  allowed_after: approved
```

文章类 workflow 只需要 `trigger`、`collect`、`output: {mode: per_run}`；`gate` 可省略或只用于外部发布。

## 4. 输出落地模式

| 模式 | 行为 | 示例 |
|---|---|---|
| append | 追加到固定 Thread（现有行为，按 execution_id 去重） | 日报、监控 |
| per_run | 每次运行新建一个 Thread | 文章生成 |
| per_item | 每个条目新建一个 Thread | 一次性通知 |
| keyed | 首次出现的 key 新建 Thread，后续同 key 追加到原 Thread | feedback、邮件往来、GitHub issue |

## 5. 插件工具（草案）

- `automation_emit(type, key, title, body, attachments?, source_meta?, status?)`
  - 只在 cron 运行中可用：插件用 `ctx.current_cron_execution()` 取得 job_id，再查到 workflow 定义和落地模式。非 cron 调用直接拒绝。
  - 幂等：`(workflow_id, key, execution_id)` 重复调用不产生重复消息。
  - 返回 `thread_id`、`created|appended`。
- `automation_define` / `automation_update` / `automation_list` / `automation_dry_run`
  - 交互对话中使用，用来创建、修改、查看和试运行 workflow。
  - 创建或修改时，同步创建或更新核心 cron job（schedule、prompt、`enabled_toolsets`、`attach_to_session=false`）。
  - 修改生成新版本，并向用户展示差异，用户确认后生效。
- `automation_set_status(thread_id, status)`：更新条目 Thread 状态。

## 5a. 新建 Thread 与绑定 session（核查结论与方案）

### 核查事实（2026-10-10）

1. 本机 cron 不在 Gateway 进程内执行。`cron/scheduler.py::_launch_external_cron_worker`：systemd 托管的 Gateway 中，job 一律交给外部 worker 进程（transient scope）。日志确认：`handed to restart-safe worker ... dispatch=scoped`（2026-10-08、09、10）。
2. worker 进程会加载插件工具（`model_tools.py` 导入时执行 `discover_plugins()`），但没有运行中的 hermes_app adapter，也没有 Gateway 内存中的 `SessionStore`。
3. 插件现有建 Thread 路径（`adapter.py` POST threads 与 `create_handoff_thread`）：
   `self._source(cid, thread_id)` → `self._session_store.get_or_create_session(source, touch_activity=False)` → `self._store.create_thread(cid, title, entry.session_id, description, thread_id=...)`（同一事务写 `threads` 和 `session_links`）。
   `SessionStore` 是 Gateway 的路由权威：同一 routing key 单飞，创建时同步写 `state.db` session 行和 `sessions.json`。
4. 因为 `SessionStore` 有内存缓存，worker 进程另建一个 `SessionStore` 写 `sessions.json`，会与 Gateway 的缓存冲突。所以 worker 不能自己建 session。
5. `live_signal` 只在单个进程内有效，worker 不能用它唤醒 Gateway。
6. cron 最终结果经核心投递队列回到 Gateway，再调用 `adapter.send(metadata.job_id)`；但最终回复为 `[SILENT]` 或空时不投递。
7. 普通 `append_message` 不受 turn lease 阻止；向一个正在运行 turn 的 session 追加行，会把内容插进该 turn 的中间。
8. 核心约定（`gateway/mirror.py`、`_maybe_mirror_cron_delivery`）：不是 agent 本身说的话，用 `role="user"` 加标签前缀写入；assistant 角色的镜像会产生 assistant→assistant，破坏严格交替的 provider。

### 方案：worker 只写 outbox，Gateway 侧 adapter 负责建 Thread

1. worker 中 `automation_emit` 只做一件事：在插件 `metadata.sqlite` 写一行 outbox（`execution_id, workflow_id, item_key, item_json, draft_json, state='pending'`），唯一键 `(execution_id, item_key)`。不碰 `SessionStore`，不写 `state.db`。
2. Gateway 进程内的 adapter 负责落地（materialize），触发时机三个，任何一个都能完成：
   - 收到该 job 的最终投递（`adapter.send` 带 `job_id`）时，先处理该 `execution_id` 的 outbox；
   - adapter `connect` 时处理全部 pending（覆盖 Gateway 重启）；
   - 轻量定时扫描 pending（例如 15–30 秒），覆盖 `[SILENT]` 和投递失败。
3. 落地一个条目（在 `_delivery_lock` 内串行）：
   1. 查 `automation_items(workflow_id, item_key)`。没有映射时：生成 `thread_id`，复用现有路径 `get_or_create_session(self._source(cid, tid), touch_activity=False)` → `create_thread(...)`，再写映射。
   2. 有映射时：按 `session_links` 取该 Thread 当前 session（与现有 cron 投递相同）。如果该 Thread 有进行中的 turn，本条保持 pending，下次再处理。
   3. 写客户原文：`append_message(role='user', display_kind='automation_item', platform_message_id='auto:<execution_id>:<item_key>', display_metadata=...)`，内容带来源标签前缀。
   4. 有草稿时写草稿：`role='assistant'`，`display_kind='automation_draft'`，`platform_message_id='auto:<execution_id>:<item_key>:draft'`。user→assistant 顺序满足交替。
   5. 写入前先按 `platform_message_id` 查重（与现有 `_deliver_background_serial` 相同），然后发布到 Thread 时间线，outbox 置为 `done`。
4. 崩溃恢复：任何一步中断后，下次扫描按 `platform_message_id` 和映射表补齐，不重复写入。

### 待实测

- 外部 worker 中插件工具读取 `ctx.current_cron_execution()` 的结果（源码显示 worker 在 `run_one_job` 中绑定身份，需要真实 fire 验证）。
- worker 与 Gateway 同时写 `metadata.sqlite` 的锁等待表现。
- 现有 append 模式写的是 `role='assistant'`，与第 8 条核心约定不一致；纯 cron Thread 中用户接着提问时是否出现 assistant→assistant，需要单独核查。

## 6. 数据（插件 metadata.sqlite）

- `workflows(id, version, definition_json, cron_job_id, enabled, created_at, updated_at)`
- `workflow_versions(workflow_id, version, definition_json, created_at)`
- `automation_items(workflow_id, item_key, thread_id, status, source_meta_json, created_at, updated_at)`，唯一键 `(workflow_id, item_key)`
- `automation_deliveries(execution_id, workflow_id, item_key, row_id)`：重试去重与崩溃恢复，沿用现有 `publish_delivery` / `recover_deliveries` 思路

消息仍写入核心 `state.db` 对应 session；插件只保存映射和状态，不建重复的聊天数据。

## 7. 消息呈现

- 客户原文：`display_kind='automation_item'`，`display_metadata` 带 source、key、发件人。不用 user 角色，避免把客户内容当作 Jamie 的发言。
- agent 草稿：普通 assistant 消息，或 `display_kind='automation_draft'`，便于 App 显示“批准 / 修改”操作。
- 空运行（没有新条目）不产生任何消息。
- 运行失败进入运行记录，不进入条目 Thread。

## 8. 写操作关口（两阶段）

1. 阶段 1（cron）：job 的 `enabled_toolsets` 不包含写工具，结构上无法执行写操作。
2. 阶段 2（Thread 内）：插件 `pre_tool_call` 检查当前 session 是否属于 automation 条目 Thread；如果工具属于 `gate.actions_toolsets` 而条目状态不是 `approved`，返回 block。
3. 批准方式：App 上的批准操作把状态改为 `approved`，并在 Thread 中触发一个 turn，让 agent 执行回复和数据更新。执行完成后状态改为 `done`。
4. 第二道保护：写工具在 cron 会话中出现时，同一个 hook 也直接 block。

## 9. feedback 来源

| 来源 | 接入方式 | key | 回复方式 |
|---|---|---|---|
| vxreels 系列站及兄弟站反馈表 | cron 轮询数据库（只读账号） | `db:<site>:<feedback_id>` | 按站点：邮件或站内回复，写回反馈记录 |
| 业务线邮箱（Resend） | 初期 cron 轮询 `GET /emails/receiving`；以后可换 `email.received` webhook | `mail:<thread root message_id>` | Resend 发信，带 `In-Reply-To` / `References` |
| GitHub issue（以后） | cron 轮询或 webhook | `gh:<owner/repo>#<n>` | issue 评论 |

注意：邮件追问的 key 要按邮件线程根 `message_id` 计算（依据 `In-Reply-To` / `References`），否则同一个客户的追问会生成新 Thread。

## 10. 推进顺序

1. 插件：workflow 存储、`automation_emit`、keyed 落地、条目映射与去重恢复。
2. 插件：`pre_tool_call` 关口与状态字段。
3. 对话工具：define / update / dry_run / list，联动核心 cron job。
4. 第一个真实 workflow：一个站点的反馈表（只读收集 + 起草 + 审批后回复）。
5. App：automation 条目状态、收件箱视图、批准操作。
6. Resend 邮件来源；之后再做文章类和 GitHub。

## 11. 待决定 / 待核查

- 业务数据库与 Resend 的读写工具以什么形式提供：MCP server、插件工具，还是 skill + 脚本。它们属于业务层，不放进 hermes_app 插件。
- 业务库只读账号与写账号要分开，凭据放在对应 profile 的 env，不进入 prompt。
- 公网 webhook 端点（Resend、GitHub）会新增对外暴露面，需要单独授权；初期用轮询可以避免这个问题。
- 用户内容属于不可信输入，可能包含提示注入。阶段 1 没有写工具，所以风险有限；阶段 2 的草稿必须经过人工审阅。
