# Automation 创建与编辑

状态：已实现，未发布。插件分支 `feat/automation-editing`（目标版本 0.2.28）；App 分支 `feat/automation-editing`（手机、共享 client、桌面）。设备验收未做。前提：只读 Automations（插件 0.2.22–0.2.24 的 `GET /v1/automations`、`GET /v1/automations/{id}`；桌面见 [desktop-automations.md](desktop-automations.md)；手机 Automations 页见 [mobile-tabs-recents.md](mobile-tabs-recents.md)）。总体方向见 [automation-workflow.md](automation-workflow.md)。插件侧投递模式见插件仓库 `docs/cron-threads.md`。

## 1. Jamie 的决定（2026-10-11 / 10-12）

1. job 运行时不带 Channel 上下文（Topic / Description），但读取 project 的 AGENTS.md，方式是 `workdir`。
2. `workdir` 在 job 创建时静态写入 job 定义（第 3 节）。不修改 core，不加 core hook。运行时动态查找的方案（`resolve_cron_workdir`）已放弃，相关 core 分支已删除。
3. 编辑对话：每个 job 一个固定 Thread、一个 session，靠自然 session compaction 控制长度，不轮换。
4. 编辑 Thread 标题：`<job 名> · 设置`。
5. 详情页直接控件：Pause / Resume、Run、编辑周期。Instructions 只读。
6. Recents 按既有规则处理，不新增规则。
7. Automations 列表分页。
8. 编辑 Thread 可以在 job 创建之前登记。

## 2. job 的归属

- 归属 Channel = job 的 `deliver` 目标（`hermes_app:<channel>:new` 或 `hermes_app:<channel>:<thread>`）。不另存归属字段。
- 只投递到本连接 App 的一个 Channel 的 job 可以编辑。其他 job（多个 Channel、Discord、`local` 等）在列表中只读显示，没有控件。
- 换 Channel = 修改 `deliver`。`workdir` 的变化见第 3 节。

## 3. 运行上下文与 `workdir`

core 事实（`~/.hermes/hermes-agent`，local/main）：

- `cron/scheduler.py` `_construct_cron_agent`：`skip_context_files=not bool(workdir)`。有 `workdir` 才加载该目录的 AGENTS.md 等 project context files；SOUL.md 总是加载。Channel Topic / Description 不进入 cron 运行。
- `cron/jobs.py` `_normalize_workdir`：创建或修改时把 `workdir` 解析为绝对路径。运行时 `_resolve_job_workdir` 只检查目录是否存在，不存在就不带 `workdir` 运行。
- core 没有 cron 运行前的插件 hook。所以插件只在创建或修改时写入 `workdir`。

规则（插件 `cron_workdir.py`，0.2.26 起；agent job 和 `no_agent` job 相同）：

1. 调用方显式设置的 `workdir` 总是优先。
2. job 只投递到一个 App Channel 时：`workdir` = 该 Channel 的 project 目录。顺序：Channel primary path；否则旧的 `Channel AGENTS source` 登记目录；否则托管工作区 `hermes-app/channels/<id>`（`workspace.agents_source` 规则）。
3. 其他 job：`workdir` = profile 工作区 `profiles/<p>/workspace`。

写入时机：

- cron 工具（`cronjob_manage`，旧名 `cronjob`）`create` 成功后，由 `post_tool_call` hook 写入。
- `update` 改变 `deliver`，并且当前 `workdir` 是本模块会选的默认值时，重新计算。
- App `PATCH /v1/channels/{id}` 重新绑定 primary path 时（`rebind_primary`）：只投递到该 Channel 且 `workdir` 等于旧目录的 job 移到新目录。
- `hermes project` CLI 的改动不同步。

注意：cron 工具返回的 JSON 在 hook 运行之前生成。要确认最终 `workdir`，读 `jobs.json`。

## 4. 编辑 Thread（settings conversation）

- 每个 job 一个编辑 Thread，位于所属 Channel。插件表 `automation_editors(thread_id PRIMARY KEY, job_id UNIQUE NULL)`；一个 Thread 最多对应一个 job。
- 一个固定 session；context 长度由自然 compaction 处理。
- 事实来源是 core `jobs.json` 中的当前定义。每一轮，插件的 `pre_llm_call` hook 告诉 agent 这个 Thread 属于哪个 job，并要求先用 cron 工具读当前定义、给出 diff、用户确认后才修改。原因：compaction 后的摘要可能保留旧版本内容。同样的规则写在插件 skill `hermes-app:cron-threads` 中。
- 运行结果不进入编辑 Thread，仍按 `deliver` 投递。
- 标题：job 链接成功后改为 `<job 名> · 设置`；job 改名时同步。
- Recents：编辑 Thread 是用户的对话（`origin=user`），按既有规则处理。
- 详情页的「Edit in conversation」调用 `POST /v1/automations/{id}/editor`：已有编辑 Thread 时返回它（200，`created:false`）；没有时创建 Thread、登记映射，返回 201。不可编辑的 job 返回 403。

## 5. 创建新 job

1. 入口：手机 Automations 页和 Channel 页的「New automation」；桌面侧栏 Automations 标题的「+」和 Automations 列表页的「New automation」。只列出服务器支持 `automation_editors` 的 Channel。
2. 客户端在该 Channel 新建 Thread（标题 `New automation`），请求带 `automation_editor: true`。插件把它登记为待创建的编辑 Thread（`job_id` 为空）。只有 `origin=user` 的 Thread 可以带这个标志。
3. agent 根据用户的描述起草定义：名称、周期、输出方式（`:new` / 固定 Thread）、Instructions、工具、模型。
4. 试运行：对一条真实数据运行一次，不投递，不执行写操作，结果只显示在这个 Thread。
5. 用户确认后，agent 调用 cron 工具 `create`：`deliver` 指向该 Channel，`attach_to_session=false`。`workdir` 由插件写入（第 3 节）。
6. 链接：`post_tool_call` 从 `session_id` 找到 Thread；如果它是待创建的编辑 Thread，就写入 `job_id` 并改标题。
7. 在普通对话中创建的 job 不自动链接（避免一个对话成为多个 job 的编辑 Thread）。第一次「Edit in conversation」时创建编辑 Thread。
8. 用户放弃时，这个 Thread 只是普通对话。Thread 归档后，插件不再把它当作编辑 Thread（查询只看未归档的 Thread）。

## 6. 详情页直接控件

| 控件 | 插件接口 | core 函数（`cron/jobs.py`） |
|---|---|---|
| Pause / Resume | `POST /v1/automations/{id}/pause`、`/resume` | `pause_job`、`resume_job` |
| Run | `POST /v1/automations/{id}/run` | `trigger_job`：设 `next_run_at=now`，下一个 tick（≤60 s）运行 |
| 编辑周期 | `PATCH /v1/automations/{id}` `{schedule}` | `parse_schedule` + `update_job`，与 cron 工具 update 相同 |
| Instructions | 只读 | — |

- `trigger_job` 会同时恢复暂停的 job。所以暂停中的 job 只有 Resume；插件对暂停中的 job 的 Run 返回 400。
- 周期文字最长 200 字符；`parse_schedule` 不接受时返回 400，客户端保留输入框并显示示例。
- 修改后插件通知外部 scheduler provider（`on_jobs_changed`；内置 ticker 无操作）。
- 详情返回 `editable`、`controls`（当前可用的控件）、`editor_channel_id`、`editor_thread_id`。`controls` 为空时客户端不显示控件。
- Run 之后客户端显示「Starting…」，直到出现新的运行记录（桌面最多 2 分钟，每 4 s 读一次）。
- 写接口使用与其他写操作相同的设备授权。capability：`automation_controls`。

## 7. 列表分页

- `GET /v1/automations?limit=<n>&after=<cursor>[&channel=<id>]` → `{automations, next_after}`。
  - 默认 `limit` 30，最大 100。
  - 排序：最近运行时间倒序，然后名称，`id` 作为最后的排序键。
  - `after` 是不透明游标。
  - `channel` 只返回投递到该 Channel 的 job。
  - 没有 `limit` 的请求（0.2.28 之前的客户端）：返回全部 job，与以前相同。
- 客户端：
  - 手机 Automations 页：滚动到底部加载下一页。Channel 页列出该 Channel 的 job。
  - 桌面侧栏：每个连接读第一页，显示前 8 项；还有更多时显示「Show all」，打开唯一的 Automations 列表 tab（滚动或「Show more」加载，每个连接一个游标）。
- capability：`automations_paged`。旧服务器上客户端一次读取全部。

## 8. 实现位置

插件（`/opt/projects/jamie/hermes-app-plugin`）：

- `automation_editing.py`：控件、`post_tool_call` 链接与改名、`pre_llm_call` 上下文。
- `storage.py`：`automation_editors` 表和读写函数。
- `automations.py`：分页和游标、详情字段。
- `adapter.py`：路由、capability（`automations_paged`、`automation_controls`、`automation_editors`）、创建 Thread 时的 `automation_editor` 标志。
- `cron_workdir.py`：静态 `workdir`（第 3 节）。
- skill `skills/cron-threads/SKILL.md`：编辑前读当前定义、diff、确认；创建时的 `deliver` / `attach_to_session` 规则。

共享 client（`packages/client`）：`automations.ts`（`automationsPage`、`automationControl`、`setAutomationSchedule`、`automationEditor`、capability 字段）；`createThread(..., { automationEditor })`，`LiveSessionClient` 的覆盖方法也转发这个选项。

手机（`apps/mobile`）：Automations tab 分页、「New automation」、`AutomationCard`、详情页控件、Channel automations 页、`NewTopicComposer` 的 `automationEditor`。

桌面（`apps/desktop`）：

- tab 种类 `automations`（唯一的列表 tab）；New chat tab 的 `automationEditor` 标志由主进程保存，并在创建 Thread 时由主进程加入请求，renderer 不能设置。
- IPC：`desktop:list-automations`（主窗口或列表 tab，可带每个连接的游标）、`desktop:open-automation-list`、`desktop:open-automation`（主窗口或列表 tab）、`desktop:control-automation` 和 `desktop:open-automation-editor`（只能操作发送方 Automation tab 自己的 job）。
- renderer：`automations.tsx`（`AutomationsSection` 的「+」和「Show all」、`AutomationListPage`、`AutomationPage` 的控件和周期表单）；`new-session-page.tsx` 的 New automation 模式。

## 9. 验证

- 插件：`tests/p1/test_automation_editing.py` 等 38 个定向测试通过。完整 p1：24 failed / 221 passed / 4 skipped；失败与 `main` 基线相同，另加 `test_real_offline_live_and_retired_routes`，该测试在 `main` 上也失败。
- 共享 client：`tests/automations.test.mjs`；`tests/live-automation-editor.test.mjs` 证明 `LivePageClient` 转发 `automation_editor`（修复前失败）。
- 手机：commit `6e155b4`，client 57 个、手机 180 个测试通过。
- 桌面：`native-tabs`（列表 tab、New automation 标志）、`connections`（分页游标、控件、编辑 Thread 的 ID 限定）、`automations-ui`（Chromium：「+」、「Show all」、列表 tab 分页、控件、周期表单、Edit in conversation）、`new-chat-model`（New automation 模式）。
- 未做：真实服务器上的端到端检查、iPhone 和 Mac 设备验收。
