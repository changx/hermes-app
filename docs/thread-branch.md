# Thread 分支（Branch）与消息 toolbar

状态（2026-10-07）：

- 已合入并发布：客户端 `main` `c4e59da`（桌面 v0.1.46、Expo 测试入口），插件 `main` `62aaafb`（v0.2.8、v0.2.9），核心 `local/main` `8735238716`。发布记录见 [message-toolbar-release-0.1.46](message-toolbar-release-0.1.46.md)。
- 插件 0.2.9 已在 hermes-app-dev 生效（2026-10-07 18:22 重启；迁移与线上验收通过，见发布记录）。
- 真机验收（iPhone、Android、macOS）尚未进行。

## 已确认的产品决定（Jamie）

- 从指定回复创建新的 App Thread，不原地 fork：原 Thread 及其 session 不变。
- 锚点只能是已完成一轮的最终 assistant 回复。
- 新 Thread 显示锚点及之前的完整历史；授权新 Thread 读取原 Thread 的附件。
- 原 Thread 显示一条链接到新 Thread 的提示；新 Thread 顶部显示链接回原 Thread 的提示。
- 上下文使用完整原文（核心 transcript 副本），不复用原 Thread 的 LCM 摘要。
- 复制 transcript 由核心 `/branch` 完成；插件只负责创建、绑定和展示 App Thread，不自行复制模型历史。
- 每条最终回复下方有常驻 toolbar（手机与桌面都常驻）：Branch、Copy、References、Export、Retry。
  - References：本轮 Agent 实际打开读取的网页（`web_extract`、浏览器导航），以及回复正文引用的链接。只出现在搜索结果里、没有打开的链接不算。
  - Export：导出这一条消息。话题的“…”菜单（桌面为 Session 工具栏）提供导出整个话题。
  - Retry：核心 `/retry` 只能重试最后一轮，所以只在最新一条最终回复上显示。
- `hermesapp://session/<thread-id>` 链接由插件和 Agent 统一省略 `server`，App 按显示该消息的连接补全。外部入口（系统唤起、剪贴板）仍要求完整格式。

## 架构

1. 核心 `/branch`（不带 `--here`）通过 adapter 的 `create_handoff_thread(parent_chat_id, title)` 打开同级 thread，再克隆 transcript，并把新 thread 的 session key 切到克隆 session（带 `_branched_from`）。原 chat 的 session key 不变。
2. 本地核心提交为插件 adapter 增加显式开关 `BasePlatformAdapter.SUPPORTS_BRANCH_THREADS`（默认 False）。只覆盖 `create_handoff_thread`（例如 relay）不会改变 `/branch` 行为。
3. 插件 `POST /v1/threads/{id}/branch {anchor_ref_seq, request_id}`：
   1. 校验锚点是已完成一轮的最终回复；原 Thread 运行中返回 `busy`。
   2. 通过 adapter 自己的消息处理入口执行 `/branch <标题> (branch)`（与输入命令同一路径、同一 profile 作用域），不产生回执，不写入原 Thread 时间线。
   3. 校验新 Thread 路由到 `_branched_from` 克隆，绑定 session。
   4. 按顺序、角色、时间戳和内容把原 session 行对应到克隆行；锚点之后第一条用户行用核心 `SessionDB.rewind_to_message`（带 `expected_active_ids`）截断。
   5. 为新 Thread 写入顶部提示和复制的 `message_refs`（最终回复标记、输入附件授权），再在原 Thread 末尾写入链接提示。
   6. `request_id` 幂等；任何一步失败都把新 Thread 归档并返回原因码（`busy`、`anchor_not_final`、`anchor_unavailable`、`history_mismatch`、`branch_failed`）。
4. 手动输入 `/branch`：锚点为原 Thread 最新的最终回复，命令回复改为链接提示（不显示核心 session ID）。
5. 分支 session 不继承原 Thread：`history_hooks._compression_parent` 已排除 `_branched_from`。
6. `GET /v1/threads/{id}/messages/{ref_seq}/sources`：读取该轮核心行的工具调用和回复正文，返回去重后的 `read`／`cited` 链接（URL 经过 `tool_timeline` 的凭据过滤）。
7. `GET /v1/threads/{id}/export`：以 Markdown 导出可见对话（工具记录只保留名称，附件只保留文件名）。
8. 存储：新表 `branches`、`branch_inputs`、`attachment_grants`；`system_notices.kind` 增加 `branch`（旧库启动时重建该表，保留全部 ID；已在 hermes-app-dev 数据副本上验证计数与外键）。

## 代码位置

- 核心：`~/.hermes/hermes-agent` `local/main` 提交 `8735238716`。
- 插件：`/opt/projects/jamie/hermes-app-plugin` `main`（v0.2.9）。测试 `tests/p1/test_branch_thread_runner.py`（真实 GatewayRunner + HTTP API + 本地合成模型；需 `HERMES_BRANCH_CORE` 指向带开关的核心）和 `tests/p1/test_branching.py`。
- 客户端：`main`（v0.1.46）。共享 `packages/client`（`branchThread`、`messageSources`、`exportThread`、短链接）；手机 `MessageToolbar.tsx`、`ChatTimeline.tsx`、`SessionOptions.tsx`；桌面 `message-toolbar.tsx`、`shell.tsx` 与主进程 IPC。

## 已知限制

- 原 Thread 运行中不能分支（核心 `/branch` 只在空闲时执行）。
- 锚点必须在原 Thread 当前 session 中；`/new` 之前的历史不属于当前模型上下文，不复制。
- 原 Thread 中的命令回复和系统提示不复制（不属于模型上下文）。
- 带附件的用户消息显示核心的附件说明文字（例如 `[The user sent a text document: …]`）；原 Thread 已经如此，分支保持一致。这是现有显示问题，另行处理。
- 手机端导出使用系统分享（文本），不是 .md 文件；桌面端保存为 .md 文件。

## 后续步骤

1. ✅ 原生 `/branch` 打开新 App Thread 并绑定克隆 session。
2. ✅ 新 Thread 显示复制的历史；按锚点截断；附件授权。
3. ✅ 分支链接提示、来源、导出、短链接。
4. ✅ 手机与桌面 toolbar。
5. ✅ 客户端合入 main 并发布 Expo 与桌面 v0.1.46；插件 0.2.9 已安装。
6. ✅ 插件 0.2.9 生效。
7. 真机验收；上游 PR：以开关替代写死列表。
