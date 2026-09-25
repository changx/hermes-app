# P0 HISTORY 证据（隔离、合成数据）

基线：Hermes snapshot `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`；本仓库 `p0/history` 隔离工作树。运行：

```sh
cd /opt/projects/jamie/_worktrees/hermes-app/p0-history
sh probes/p0/history/run.sh
```

该脚本以 `env -i` 清除凭据，`HOME` / `HERMES_HOME` 指向 lane-private 目录，使用基线 `.venv/bin/python` 和只读源码。临时 `state.db` / `projects.db` 位于 `/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/p0/history/history-probe-*/`，正常退出即清理；仅 `probes/p0/history/evidence.json` 留存。没有真实聊天、付费模型、远端写入。压缩摘要及消息均是**合成数据**，但 SessionDB 写入、归档、重开、模型/展示投影、REST handler、TUI 展示投影、Channel resolver/拼装与 Agent 构造参数装配来自真实基线源码。注意：`.venv` 的 SQLite 3.50.4 被 Hermes 判定有 WAL-reset 风险，测试自动切换 `journal_mode=DELETE`，不能将此结果外推到生产 WAL 并发。

## 实际执行

`sh probes/p0/history/run.sh` 退出码 **0**，输出 `PASS P0 history probe`。JSON 机器证据在 [`../../probes/p0/history/evidence.json`](../../probes/p0/history/evidence.json)。关键 stdout 数值：

| 条件 | 预期/实际 |
|---|---|
| 原始可见正文、冷重开、分页 | 4 条原始用户/助手正文；关闭并重开真实 DB 后仍 4 条；压缩后分 2 条/页取到 7 条 DB 展示行（4 原文、2 脚手架、1 摘要），经真实 TUI 投影为同样 4 条正文。 |
| 同一物理 session 原地压缩 | 模型投影 3 行、DB 展示投影 7 行；早期原文仍可见，但模型看不到旧原文；摘要存在于模型投影，不出现在普通正文。`hidden` 和 `[System:]` 脚手架被过滤。 |
| 冷重开与 lineage | 根 + 压缩 continuation 共 2 段，重开后展示 5 条真正正文；无新 user 输入的 continuation assistant 答复没有被裁掉；标记为 branch 的 sibling 被排除。 |
| row ID | 老头部 2 个 `messages.id` 在此场景保留；压缩 carry-forward 的尾部 2 条内容仍存在，但代表行的 ID 已变化。 |
| REST 读取 | 实际调用 `get_session_messages` handler，复用真实 `_with_db` / 真实 DB read-only handle，仅将 DB opener 指向隔离 DB；传根 session ID 返回 child tip ID 和 2 条 child 行，不含根段最早问题；相同 child 的 `get_resume_conversations` 展示 5 条正文。 |
| idle | 真实 `_should_idle_compact` 在合成空闲/令牌阈值下触发，前次压缩后未增长足量则阻止；未运行自主 idle 调度器或模型摘要。 |
| Channel | `resolve_channel_prompt` 按 thread 覆盖优先、否则继承 parent；`TurnRunner._combined_ephemeral_prompt` 拼装后，通过真实 `_build_fresh_agent` 参数装配传入 `ephemeral_system_prompt`（仅 AIAgent 构造函数是捕获参数的替身）。另一个 channel 无串提示。projects.db 的 Description 关闭重开保留，但未配置 channel_prompts 时不会自行进入上述链路。 |

## P1 前的最小缺口（不是本次修复）

1. **统一用户可见 Thread 历史读取**：现有 REST `GET /api/sessions/{id}/messages` 重定向至压缩 tip，然后分页读取该段；`session.resume` 的展示路径会跨压缩 lineage。必须统一冷分页与在线/恢复投影并携带稳定 Thread 身份，跨段分页和去重/隐藏语义一致；不能把整个 descendant tree（如 branch / worker）直接拼接。此处只验证了一条压缩链，不覆盖 gateway reset 产生的新 root。
2. **稳定业务消息身份**：`messages.id` 是物理行 ID；压缩携带尾部会重新插入、改 ID。稳定逻辑 ID / 顺序 / 重绑定规则需要由权威服务端定义，跨页、反应、引用、双设备合并均不能直接假设当前 `row_id` 永不变。这里没有证明所有消息 ID 都改变；老头部在此场景保持原 ID。
3. **Project Description → Channel 公共提示**：Hermes Project 的 `description` 持久化在 `projects.db`，配置 `channel_prompts` 的 gateway resolver 继承可用，但自动桥接尚无证据；此 probe 用显式 config map 证明下游链路，不等于 Project UI Description 已自动进入新 Thread 的模型上下文。旧 Thread 动态更新是*建议、未批准*；不能为了热更新破坏现有 conversation 缓存前缀/系统提示字节稳定性。必须先定生效边界、权限与 prompt-cache 策略。
4. **未验证项**：未执行真实 paid model、自动压缩摘要/idle checkpoint、native Responses compaction、真实客户端流式事件与断线多端同步、附件或 gateway 服务全链路；本探针不能证明这些保证。父任务的异步通信 lane 另行覆盖同步。任何超出本次确定性 DB/投影路径的结论保持未测。

源码锚点：`hermes_state_messages.py` 的 `archive_and_compact`、`get_resume_conversations`、`get_messages`；`hermes_state_compression.py` 的 `get_compression_chain`；`hermes_cli/web_routers/sessions.py::get_session_messages`；`tui_gateway/session_history.py::_history_to_messages`（通过 `tui_gateway.server` rebound）；`agent/turn_context.py::_should_idle_compact`；`gateway/platforms/base.py::resolve_channel_prompt`；`gateway/run_turn_runner.py::TurnRunner`；`tui_gateway/methods_projects.py` / `hermes_cli/projects_db.py`。
