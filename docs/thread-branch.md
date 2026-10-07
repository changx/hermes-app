# Thread 分支（Branch）

状态：第 1 步（原生 `/branch` 打开新 Thread）已实现并通过隔离测试。核心提交 `8735238716` 已在 `local/main`；插件 0.2.8 已安装到 hermes-app-dev（2026-10-07），等待 Gateway 重启后生效与验证。第 2–4 步未实现。

## 已确认的产品决定（Jamie）

- 从指定回复创建新的 App Thread，不原地 fork：原 Thread 及其 session 不变。
- 锚点只能是已完成一轮的最终 assistant 回复。运行中的一轮不提供分支。
- 新 Thread 显示完整的历史副本。
- 每条最终回复下方有紧凑 toolbar，手机端常驻。第一版只有 Branch 按钮。
- 复制 transcript 由核心 `/branch` 完成；插件只负责创建和绑定 App Thread，不自行复制历史。

## 架构

1. 核心 `/branch`（不带 `--here`）通过 adapter 的 `create_handoff_thread(parent_chat_id, title)` 打开同级 thread，再克隆 transcript，并把新 thread 的 session key 切到克隆 session（带 `_branched_from`）。原 chat 的 session key 不变。
2. 核心原先只对写死的 `BRANCH_THREAD_PLATFORMS`（Discord/Telegram/Slack/Matrix）这样做，其他平台一律原地分支。
3. 本地核心提交为插件 adapter 增加显式开关 `BasePlatformAdapter.SUPPORTS_BRANCH_THREADS`（默认 False）。只覆盖 `create_handoff_thread`（例如 relay）不会改变 `/branch` 行为。
4. 插件 `HermesAppAdapter` 设置该开关，`create_handoff_thread` 在同一 Channel 下创建 App Thread（继承 Channel Description）。核心切换后，插件在命令回复送达时把克隆 session 绑定到新 Thread。若 Gateway 在两者之间停止，新 Thread 第一次收消息前会按 SessionStore 路由补绑。已被其他 Thread 拥有的 session 不会被接管。
5. 分支 session 不继承原 Thread：`history_hooks._compression_parent` 已排除 `_branched_from`。

## 代码位置

- 核心：`~/.hermes/hermes-agent` 分支 `jamie/branch-handoff-optin`（基于 `jamie/upstream-20261007b`）。同一提交修复了 `_branch_open_thread` 对 `adapter._threads.mark_async` 的假设；Hermes App 的 `_threads` 是 HTTP handler。
- 插件：`/opt/projects/jamie/hermes-app-plugin` 分支 `feat/branch-handoff-thread`。
- 测试：核心 `tests/gateway/test_branch_thread_command.py`；插件 `tests/p1/test_branch_thread_runner.py`（真实 GatewayRunner + HTTP API + 本地合成模型，需 `HERMES_BRANCH_CORE` 指向带开关的核心；固定 P0 基线下跳过）。

## 已知限制

- 核心 `/branch` 只在 session 空闲时执行（`_IDLE_COMMANDS`），原 Thread 运行中不能分支。
- 核心复制当前压缩段（`load_transcript` 跟随 compression tip），压缩边界之前的回复不能作为锚点。
- 命令回复留在原 Thread，文本包含核心 session ID 和 thread ID。按钮流程中需要改为用户可理解的提示。
- 若 `create_handoff_thread` 成功而核心克隆失败，会留下一个空 Thread（核心的既定顺序：先建 thread，避免孤立的分支 session）。

## 后续步骤

1. ✅ 原生 `/branch` 打开新 App Thread 并绑定克隆 session。
2. 新 Thread 显示复制的历史：插件时间线来自 `message_refs`，克隆行目前不显示。
3. 按锚点截断：用核心 `SessionDB.rewind_to_message` 及其校验参数，截断目标为锚点之后第一条 user 行。
4. 客户端 toolbar 与 Branch 按钮、幂等请求 ID、命令回复改为系统提示。
5. 部署：核心提交进入运行中的核心分支后，所有 profile 在 Gateway 重启后生效；插件安装到 hermes-app-dev。上游 PR：以开关替代写死列表。
