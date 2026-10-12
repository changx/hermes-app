# Automation 创建与编辑设计

状态：设计已确认，未实现。前提：现有只读 Automations（插件 0.2.22–0.2.24 的 `GET /v1/automations`、`GET /v1/automations/{id}`；桌面见 [desktop-automations.md](desktop-automations.md)；手机 Automations 页见 [mobile-tabs-recents.md](mobile-tabs-recents.md)）。总体方向见 [automation-workflow.md](automation-workflow.md)。插件侧投递模式见插件仓库 `docs/cron-threads.md`。

## 1. Jamie 的决定（2026-10-11）

1. job 运行时不带 Channel 上下文（Topic / Description），但读取 project 的 AGENTS.md，方式是 `workdir`。
2. job 绑定 Channel；`workdir` 每次都按 Channel 当前的 primary path 确定（第 3 节）。
3. 编辑对话：每个 job 一个固定 Thread、一个 session，靠自然 session compaction 控制长度，不轮换。
4. 编辑 Thread 标题：`<job 名> · 设置`。
5. 详情页直接控件：Pause / Resume、Run、编辑周期。Instructions 只读。
6. Recents 按既有规则处理，不新增规则。
7. Automations 列表分页。
8. 编辑 Thread 可以在 job 创建之前登记。

## 2. job 的归属

- 归属 Channel = job 的 `deliver` 目标（`hermes_app:<channel>:new` 或 `hermes_app:<channel>:<thread>`）。不另存归属字段。
- 换 Channel = 修改 `deliver`，并按第 3 节同步 `workdir`。
- 不投递到 App 的 job（Discord、`local` 等）在列表中只读显示，不提供编辑控件。

## 3. 运行上下文与 `workdir`

core 事实（`~/.hermes/hermes-agent`，local/main）：

- `cron/scheduler.py` `_construct_cron_agent`：`skip_context_files=not bool(workdir)`。有 `workdir` 才加载该目录的 AGENTS.md 等 project context files；SOUL.md 总是加载。Channel Topic / Description 不进入 cron 运行。
- `cron/jobs.py` `_normalize_workdir`：创建或修改时把 `workdir` 解析为绝对路径（`resolve()`，符号链接也被解析）。运行时 `_resolve_job_workdir` 只检查目录是否存在，不存在就不带 `workdir` 运行。
- core 没有 cron 运行前的插件 hook（`hermes_cli/plugins.py` `VALID_HOOKS`）。所以运行时不能动态决定 `workdir`。

插件事实：project AGENTS.md 的位置由 `workspace.agents_source(channel_id)` 决定：Channel primary path（不是托管工作区时）；否则旧的 `Channel AGENTS source` 登记目录；都没有时为托管工作区根目录 `root_path(channel_id)`。

规则：job 的 `workdir` = 上述 AGENTS.md 所在目录。因为 core 存的是固定路径，"每次读 primary path" 由插件同步实现：

1. 创建和修改 job 后：`post_tool_call` 看到 `cronjob` create/update 成功，就按规则核对该 job 的 `workdir`，不一致时用 `update_job` 改正。
2. App 修改 Channel primary path 后（`workspace.bind_primary`）：更新投递到该 Channel 的所有 job。
3. 对账：Gateway 启动时，以及每次读取 Automations 列表时，核对并改正。这覆盖 App 之外的修改（例如 `hermes project` CLI）。
4. 改正写入 job 定义，并在下一次运行生效。

扩展点缺口（报告，不打补丁）：core 不能在运行时由插件提供 `workdir`。如果以后 core 增加 cron 运行前 hook 或动态 `workdir`，同步机制可以去掉。

## 4. 编辑 Thread

- 每个 job 一个编辑 Thread，位于所属 Channel。插件保存映射 `automation_editors(job_id, thread_id)`；一个 Thread 最多对应一个 job。
- 一个固定 session；context 长度由自然 compaction 处理。
- 事实来源是 core `jobs.json` 中的当前定义。agent 修改前先读当前定义，给出 diff，Jamie 确认后才写入。原因：compaction 后的摘要可能保留旧版本内容。这条规则写进插件自带的 skill（扩展 `hermes-app:cron-threads`）。
- 运行结果不进入编辑 Thread，仍按 `deliver` 投递。
- 标题：job 链接成功后改为 `<job 名> · 设置`；job 改名时同步。
- Recents：编辑 Thread 是 Jamie 的对话（`origin=user`），按既有规则处理。
- 详情页的「Edit in conversation」打开编辑 Thread。没有编辑 Thread 的 job（例如在其他对话或 CLI 中创建）第一次点击时，插件创建 Thread、登记映射，然后打开。

## 5. 创建新 job

1. 入口：Automations 页和 Channel 页的「New automation」。从 Channel 进入时 Channel 已确定；从 Automations 进入时预选上次使用的 Channel。
2. 客户端在该 Channel 新建 Thread，并把它登记为"待创建的编辑 Thread"（`automation_editors` 中 `job_id` 为空）。
3. agent 根据 Jamie 的描述起草定义：名称、周期（文字 + cron）、输出方式（`:new` / 固定 Thread）、Instructions、工具、模型。
4. 试运行：对一条真实数据运行一次，不投递，不执行写操作，结果只显示在这个 Thread。
5. Jamie 确认后，agent 调用 `cronjob create`：`deliver` 指向该 Channel，`attach_to_session=false`，`workdir` 按第 3 节。
6. 链接：`post_tool_call` 的参数包括 `tool_name`、`result`、`session_id`（`model_tools.py`）；`cronjob create` 成功时 `result` 含 `success` 和 `job_id`（`tools/cronjob_tools.py` `_action_create`）。插件用 `thread_for_session(session_id)` 找到 Thread；如果它是待创建的编辑 Thread，就写入 `job_id`、改标题，并核对 `workdir`。
7. 在普通对话中创建的 job 不自动链接（避免一个对话成为多个 job 的编辑 Thread），按第 4 节在第一次编辑时创建编辑 Thread。
8. Jamie 放弃时，这个 Thread 只是普通对话；空的登记记录随 Thread 归档清除。

## 6. 详情页直接控件

| 控件 | 插件接口（候选） | core 函数（`cron/jobs.py`） |
|---|---|---|
| Pause / Resume | `POST /v1/automations/{id}/pause`、`/resume` | `pause_job`、`resume_job` |
| Run | `POST /v1/automations/{id}/run` | `trigger_job`：设 `next_run_at=now`，下一个 tick（≤60 s）运行 |
| 编辑周期 | `PATCH /v1/automations/{id}` `{schedule}` | 复用 `cronjob` update 的校验和 `next_run_at` 重算（实现前核对） |
| Instructions | 只读 | — |

- `trigger_job` 会同时设置 `enabled: True` 并清除暂停状态。所以暂停中的 job 只显示 Resume，不显示 Run。
- Run 之后显示「Starting…」，直到出现新的运行记录。
- 只对投递到本连接 App 的 job 显示控件。写接口使用与其他写操作相同的设备授权；新 capability `automation_controls`，旧服务器上客户端隐藏控件。

## 7. 列表分页

- `GET /v1/automations?limit=<n>&after=<cursor>[&channel=<id>]` → `{automations, next_after}`。
  - 默认 `limit` 30，最大 100。
  - 排序不变：最近运行时间倒序，然后名称；`id` 作为最后的排序键，保证游标稳定。
  - `after` 是不透明游标，编码最后一行的排序键和 `id`。
  - `channel` 过滤只返回投递到该 Channel 的 job，供 Channel 页使用。
  - 没有 `limit` 的旧客户端：服务器返回第一页并带 `next_after`，旧客户端忽略它。（是否保留旧的"全部返回"行为，实现前确认现有客户端的处理。）
- 客户端：
  - 手机 Automations 页：滚动到底部加载下一页。
  - 桌面侧栏 Automations 区：只显示第一页的前几项，加一行「Show all」，打开完整列表页（滚动加载）。
  - Channel 页：用 `channel` 过滤列出该 Channel 的 job。
- 新 capability `automations_paged`；旧服务器上客户端按现有方式一次读取。

## 8. 插件改动概要

- 新表 `automation_editors(thread_id PRIMARY KEY, job_id NULL UNIQUE)`。
- 写接口（第 6 节）、分页（第 7 节）和 capability。
- `GET /v1/automations/{id}` 增加 `editor_thread_id`。
- `workdir` 计算与同步（第 3 节），`post_tool_call` 链接（第 5 节）。
- skill：编辑前读当前定义、diff、确认；创建时的 `deliver` / `attach_to_session` / `workdir` 规则。

## 9. 待决定

- 无。实现前需要核对的项目：`cronjob` update 的校验路径（第 6 节）；旧客户端对分页字段的处理（第 7 节）。
