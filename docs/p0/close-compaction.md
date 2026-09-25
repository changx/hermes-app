# P0 compaction 收口：真实提交链路与未通过边界

> 主控补充：现已增加默认 `inplace` / `inplace_idle` 两模式及正常 `tui_gateway.server` 绑定后的完整显示转换。四模式显示前后序列均不相等；原地模式 Description 重建后保留，rotation 模式仍缺父快照映射。fresh-agent 重建同时存在可定位的 cwd 漂移，不能推导成同 runtime 的冷恢复必然丢头部。最新细节、计数与判断以 [final.md](final.md) 和 `probes/p0/close-verification/results.json` 为准。下文保留首次两模式证据的边界；原始日志可从子代理提交 `3adff31b17d05bf6023b3a35be63823a415d26d2` 恢复。

## 范围和执行

固定只读 Hermes 基线 `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`；仅使用隔离 HOME/HERMES_HOME、临时 SQLite 和 127.0.0.1 合成 OpenAI-compatible summarizer。不修改 Hermes 核心、不 monkeypatch、不安装依赖、不接触生产凭据。重用 `probes/p0/plugin-e2e/plugin/` 的正式 `register_system_prompt_section` 插件；直接驱动真实 `AIAgent._compress_context`（legacy rotation）及 `agent.turn_context_compaction._idle_compaction`（真实 idle 判断与提交入口），并调用真实 `SessionDB`。**没有在本探针重新运行 GatewayRunner；此前的 GatewayRunner 正常/断线/冷恢复链路见 [plugin-e2e](plugin-e2e.md)，不能把两次试验拼成一个已通过的完整网关压缩验收。**

从本 worktree 根目录复现：

```sh
uv run --no-project --offline --python /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python probes/p0/close-compaction/run.py rotate idle
```

`run.py` 为两个模式各启一个受限子进程（每个 150 秒超时，超时杀进程组），隔离网络代理指向 loopback 不可用端口，仅允许本地 summarizer；原始日志及机器结果在 `probes/p0/close-compaction/{rotate,idle}.{log,json}` 和 `runs.json`。最终执行的控制器 **退出 1**，两子进程各退出 1，结果均新鲜且临时 HOME 删除。**不得标为通过。** 早期搭建尝试因环境初始化顺序导致插件没有加载、手工构造历史导致重复 flush；最终改用配置落盘后加载插件、`SessionDB.get_messages_as_conversation` 带 persisted marker 的历史；早期失败日志被最后一次运行覆盖，最终失败证据保留。

## 确认与负结果

- 两个模式各有一次真实流式 `/v1/chat/completions` summarizer HTTP 调用；非静态假摘要替身，返回内容是**明确标注的本地合成摘要**。两次都真实提交 parent → child，`end_reason=compression`，child 的 `parent_session_id` 正确。`compression.in_place: false` 显式开启 legacy 物理 successor（基线默认 `true`，见 `agent/agent_init.py:1534-1536`）。idle 模式配置 `idle_compact_after_seconds: 1`，模拟 3600 秒旧活动时间，日志出现 `Resumed after 3600s idle`；这是**下一用户轮开始时**的 idle 路径，不是 background timer。压缩前的真实用户/助手消息在 parent 原样逐条保留（两模式 `parent_original_users_intact=true`, `parent_original_replies_intact=true`）。
- 初始化 Description 只渲染一次；真实压缩提交边界重建 head 时 callback 又调用一次，重建 head 仍只含一份原说明；child 存储 head 也含一份。源码 `agent/conversation_compression.py:4055-4064` 在提交前强制重建，`3314-3324` 创建 child 并写入该 header。这里的基线 fixture 仅把快照按**原物理 session_id** 存入 JSON，未把它映射到 child。
- **未通过：**新 `AIAgent` 对 child 的 `_restore_or_build_system_prompt` 未沿用原头部；输出 `fresh_agent_header_identical=false`, `fresh_agent_description_count=0`, callback 重新执行。对该 agent 进行真实 `invalidate_system_prompt` / `build_system_prompt` 后 `successor_rebuild_description_once=false`。正式插件 callback 见 `probes/p0/plugin-e2e/plugin/adapter.py:126-137`：仅 `snapshots.get(info['session_id'], '')`，child 新 ID 查不到父快照；不能以落盘 child header 目前正确代替后续重建安全性。`agent/system_prompt.py:113-135,734-750` 说明重建/快照机制，`agent/conversation_loop.py:659-761` 说明存储提示恢复或因 runtime identity 改为重建的分支。本 probe 的“fresh agent”是同进程新对象，**并非独立进程 cold resume**；初始 Session 的冷进程证据仍以 plugin-e2e 为准。
- **可见历史未验收：**经 `SessionDB.get_messages_as_conversation(child, include_ancestors=True, include_compacted=True)` 和 `agent.compaction_display.project_compaction_message_for_display` 的粗显示投影，Description 和 synthetic summary 均未泄漏；但确切内容/次数断言失败，两模式 `display_counts={user:16,assistant:18}`（原始数据各 16）。这里只运行了显示投影的部分，不是客户端完整 UI 读接口；不能把多出的 assistant 行直接归因为产品真实历史 bug，也不能宣称 R04 验收通过。`hermes_state_messages.py:1111-1127` 是展示读取与去重路径，`tui_gateway/session_history.py:195-261` 是进一步展示过滤路径，P1 必须经网关展示 API 及双端验证。

## 最小 P1 行动（规划，未实施）

1. 在独立 plugin 自有元数据中维护稳定 Thread → lineage root / 当前 tip 映射及**原始 Description 初始化快照**；callback 收到 child `session_id` 时，从 Hermes 现有 `parent_session_id` 且 parent `end_reason='compression'` 的链只读向上查 root，再取 root 快照；不得对未知 child 默默返回空说明。可用 `SessionDB.get_compression_tip` 与 `gateway/session_transcript.py:60-67,178-184` 的 tip 逻辑做跟随，遵守权限/配置及内部接口版本边界。压缩提交后的 tip 更新、冷恢复及多进程访问须原子可验证；不可改核心、不可把 Description 逐消息注入或写入普通聊天正文。
2. 基于真实 GatewayRunner 挂载该 plugin 的隔离集成测试，同时跑显式 `in_place:false` successor、默认 `in_place:true` 和下一轮 idle；审查 parent→child、callback 次数、cold process 原始 header、重建、用户展示 API 的用户/助手原文逐条有序且不重。处理本探针多出的 assistant 投影差异后才能关闭 R03/R04 压缩验收；不要拿本文的 direct-agent 结果充当完整客户端测试。
3. 在未批准 P1 之前保持上述为计划，不部署、不改服务端状态、不关闭卡片。

## Native Responses 独立边界（仅源码核对）

本地 route 是 `provider=custom`, `model=p0-local`, `/chat/completions`；没有 `/responses`、provider checkpoint、原生 compaction 或上游回放测试。基线 `agent/native_compaction.py:51-74,132-164` 要求可用模型家族（如 `gpt-5.6`）**及**直连 OpenAI/Codex 或狭窄已验证本地代理；已解析的 `runtime_capabilities.native_compaction=false` 会先拒绝，即使另有 trusted proxy 请求标记也不能单独开启。`compression.enabled=false`、`codex_responses_native_compaction=false`、`checkpoint_required=true` 等也禁止自动 native。`agent/turn_context_compaction.py:143-218` 的 legacy idle 是下一轮摘要，不能与 `agent/native_maintenance.py` 的后台 native idle 混淆。若将来要宣称 native 支持，必须在获授权的可用 upstream 上分别验证 inline `context_management` 的实际 `compaction` output item，以及仅用 checkpoint 的后续恢复/事实召回；一个 `/responses/compact` 404 或本地摘要成功都不构成结论。没有做上述付费/上游试验。

## 环境与证据边界

SQLite 3.50.4 WAL-reset 警告由 Hermes 回退 DELETE journal，未修改共享解释器。最终 `runs.json` 两次 `temporary_home_removed=true`；本地模型服务 shutdown/join 在 probe `finally` 中，进程退出。证据 JSON 仅含合成模型请求元数据、布尔/计数，不含用户真实聊天。
