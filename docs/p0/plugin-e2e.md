# P0：真实 Gateway 执行与 Session 头部上下文

## 结论

在固定且未修改的 Hermes 基线 `2f16a1aa5a35feec496949abdef7ad51aea0e7ef` 上，主控已运行正常插件加载 → `GatewayRunner.start()` → 真实 `AIAgent` → 本机合成模型端点 → 真实 `SessionDB` 的链路。

**Channel Description 可通过正式 `register_system_prompt_section` 放入 Session 头部，正常续聊及冷恢复无需业务层重复注入。** 此结论不等于完整压缩、物理 successor 映射或全部多端同步已通过。

本探针只使用合成身份、消息、模型响应；没有真实付费模型、工具副作用、生产配置修改或部署。

## 可复现执行

在仓库根目录执行，保留既有固定基线及其开发解释器：

```sh
uv run --no-project --offline \
  --python /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python \
  probes/p0/plugin-e2e/run.py header

uv run --no-project --offline \
  --python /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python \
  probes/p0/plugin-e2e/prompt_regressions.py
```

两条命令均退出 0。第二条运行上游提示段注册、缓存恢复及 compaction prompt rebuild 定向回归，**14 passed**。上游测试中存在测试替身，不能用此数量代替真实端到端压缩证据。

机器证据：
- [results-header.json](../../probes/p0/plugin-e2e/results-header.json)：真实链路与头部验收。
- [runs-header.json](../../probes/p0/plugin-e2e/runs-header.json)：子进程退出码、结果新鲜度、临时目录清理。
- [prompt-regressions.json](../../probes/p0/plugin-e2e/prompt-regressions.json)：回归命令、数量、前后核心提交一致。
- 同目录 `header.log`、`prompt-regressions.log` 保存原始 stdout/stderr。

## 实测保证

1. **真实插件入口**：临时 `HERMES_HOME/plugins/` 中的 manifest 经正常 loader 加载，注册 platform 和 system prompt section；没有手动替换 runner handler 或核心函数。
2. **离线后继续**：真实 TCP 客户端提交后关闭；模型响应此时仍被门控，没有 final。放行后真实 Agent 完成，结果写入 SessionDB。此证据仅是本次短时断线，不代表无限期运行或跨进程恢复执行。
3. **正常连续对话**：同一 Thread 两条用户消息、两条 final；另一个 Channel 的 Thread 一条用户消息、一条 final。重连与独立数据库句柄内容一致，冷进程读回一致。
4. **Session 头部一次初始化**：两个 Session 的提示段 callback 各调用一次。所有入站事件 `channel_prompt` 均为空；Description 只在 system header 中出现一次，不在用户/助手正文中。
5. **续聊沿用**：同一 Session 两次正常模型请求的完整 system header 字节一致。无状态模型 API 重传既有 header，不是新增一份 Description。
6. **冷恢复沿用**：另起进程加载真实插件，恢复真实 SessionDB 中保存的完整头部，字节完全一致，callback 未增加。
7. **受控重建**：调用真实 `invalidate_system_prompt` 和 `build_system_prompt` 后，callback 增加一次，从 Session 初始化快照返回原说明；重建头部仍只含一份说明，聊天消息没有追加。

## 最小插件方式与兼容边界

正式扩展点：`hermes_cli/plugins.py` 的 `PluginContext.register_system_prompt_section`。恢复路径见 `agent/conversation_loop.py::_restore_or_build_system_prompt`；缓存及重建见 `agent/system_prompt.py`。

callback 元数据包含 `session_id`，不直接包含 Channel/Thread。本 fixture 在入站执行前通过已有 `SessionStore.get_or_create_session` 确认 Session，并把初始 Description 存到插件自有的小型映射。聊天原文及完整系统头部仍由 Hermes 存储，没有改核心 schema 或另建聊天库。

此映射是探针，不是生产实现：它依赖 adapter 的内部 `_session_store`，使用单进程临时 JSON；尚无原子迁移、权限、删除清理或物理 successor 继承。正式插件必须记录内部接口版本边界，并复用稳定 Thread/lineage 映射来返回原 Session 的说明。不能在 successor 查不到映射时直接返回空说明。

Hermes 的重建边界会重新执行插件 callback。用户要求的是同一逻辑 Session 不重复追加 Description；实现应返回初始化快照，而不是逐消息读取或默认热更新 Channel。说明修改对已有 Session 的生效策略仍未决定。

## 已保留的旧诊断与失败

`normal`、`after_persist`、`gated` 模式是此前逐事件 `channel_prompt` 接口诊断，保留结果供追溯；不再作为 Session 头部需求的验收方式。

- `normal` 退出 0。
- `after_persist` 退出 0，但首轮已入库、任务仍活动时，第二个请求未包含 ephemeral Description。这不能推导为上述 Session 头部方案的缺陷。
- `gated` 退出 1，未生成新结果 JSON：模型被阻塞时再次提交，旧探针对 `accepted` 的假设失败。没有足够证据宣称消息丢失或被持久排队；运行中追加/steer 的语义仍须单独验证。
- [runs.json](../../probes/p0/plugin-e2e/runs.json) 保存旧三模式真实结果，整体并非全通过。默认命令现只运行修正后的 `header` 验收；没有删除或把失败改成通过。

## 仍未验证

- 实际 summarizer 压缩、idle 触发全链路、native Responses 压缩，以及物理 successor 的提示快照继承；受控 rebuild 不能替代这些。
- 消息持久接收与执行入队的崩溃窗口、进程重启后的准确任务状态，以及副作用恢复策略。
- 真实 Agent 事件接入持久增量日志后的双端/长离线/跨重启同步。
- 真正多端审批撤卡与重启过期处理、实际 cron fire 的持久历史投递。
- 此 `/history` 是 raw DB 诊断，含 `session_meta`，不是用户展示 API；稳定 ID、分页及完整展示投影仍沿用各分路报告中的缺口。
- fixture 仅 loopback、固定身份，不是生产远程认证/附件/手机推送实现。

## 环境与清理

本次 header 和回归运行均报告临时 profile 已清理，模型服务器线程停止，核心 tracked source 前后无改动；未向共享 `.venv` 安装依赖。

SQLite 3.50.4 触发 WAL-reset 风险警告，Hermes 使用 DELETE journal；未为此任务升级运行时。合成模型缺少注册 context length 时回退 256k。早期子代理日志另有 UNIX socket 路径过长警告；它不影响已报告的退出码，但也不应删除掩盖。

P0 汇总仍开放。该探针关闭的是“真实执行入口及 Session 头部”的证据缺口，不能声明底层能力全部就绪或客户端已完成。
