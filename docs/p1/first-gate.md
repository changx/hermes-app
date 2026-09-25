# P1-01/02 第一 gate：局部实现，历史验收未通过

日期：2026-09-25。Jamie 已授权隔离环境中的 P1 本地实现；本记录不表示部署、活动 profile 安装或 P1 整体完成。测试使用只读 Hermes 基线 `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`、其现有 Python 环境、隔离 `HOME`/`HERMES_HOME` 和仅监听 `127.0.0.1` 的合成模型。没有真实凭据或付费模型调用。

## 已落地

- `plugins/hermes_app/`：可由 Hermes 正常发现的 `plugin.yaml`、`register_platform`、单个 aiohttp HTTP/WS listener、固定 `owner` 与环境令牌认证。默认仅 loopback；HTTP/WS 拒绝缺失或错误令牌，拒绝客户端指定 profile。`GatewayRunner` 正常 wiring；停止时关闭打开的 WS 和 listener；禁用配置时不启动 adapter。
- Channel 使用 Hermes `projects_db` 的 Project。插件 SQLite 仅存 Thread ID、Project 关联、根 Session ID、创建时的 Description 和一次初始化标记，不存聊天正文。Thread 的 `DELETE` 是可恢复归档；有 Thread 的 Channel 拒绝物理删除。
- 新 Thread 的 Channel Description 在正式系统提示 section 回调中使用一次。Channel 后续修改只影响新 Thread。续聊、压缩物理 successor、改变 cwd 的提示重建不会由插件重新注入。
- `/v1/threads/{id}/messages` 当前明确返回 **501**。发送仅回 `202 dispatched_volatile` 且 `durable:false`；能力响应明确将稳定历史、持久接收/同步、附件、审批标成不可用。不得把此响应解释为持久接收。

## 实测与阻塞

`tests/p1/test_runner.py` 使用实际 `GatewayRunner`、两个 aiohttp WS 客户端及实际 AIAgent 到合成模型的请求。它验证鉴权、单 owner、Project/Thread、说明变更、双 Thread 原始 SessionDB 隔离、续聊、停机和禁用。机器结果见 [runner.json](evidence/runner.json) 与 [runner-disabled.json](evidence/runner-disabled.json)。

`tests/p1/test_compression.py` 对实际 AIAgent summarizer 运行默认原地、显式 rotation、idle 与原地 idle 四个模式。初始化说明在真正第一次 prompt 中出现一次，变更 cwd 后重建的插件说明出现零次；相同正文的两条用户消息在观测的显示投影中仍各有两条，原始核心行 ID 均保留。然而现有 `tui_gateway.server._history_to_messages(SessionDB.get_messages_as_conversation(...))` 在四种模式均不能保持压缩前可见顺序：原地为 32→32 但乱序，rotation 为 32→34 且乱序/重复。压缩后出现新核心行 ID；仅凭现有显示投影和物理 row ID 不能直接成为稳定消息引用。证据见 [inplace](evidence/compression-inplace.json)、[rotate](evidence/compression-rotate.json)、[idle](evidence/compression-idle.json)、[inplace idle](evidence/compression-inplace_idle.json)。

两条针对性路径已验证：先直接复用核心显示投影，严格序列失败；再检查原始行保留及压缩重写后的行 ID，确认虽能读取旧正文，active 副本有新 ID 且缺少可直接复用的原行引用。基线提供的 `pre_auxiliary_call` 只观察实际辅助模型请求，不是覆盖所有压缩/重写且与提交原子绑定的历史引用钩子。当前未找到足以保证常规/idle/rotation 和冷恢复均稳定的 plugin-only 映射，因此没有用正文哈希或第二份 transcript DB 掩盖缺口。

未达到 P1-02 的稳定消息 ID、有界历史分页、压缩后严格序列、旧行外部删除显式反馈、branch 排除等验收。P1-03..05 不应据此 gate 放行。建议下一步先确定可在实际压缩提交前后可靠建立旧行到逻辑消息映射的正式扩展点，或获得允许改变核心扩展点的单独决策；这不是已授权修改核心的请求。

## 重跑

```sh
UV_CACHE_DIR=/home/hermes/.hermes/profiles/jamie/cache/scratch/uv-p1 \
uv run --no-project --offline \
  --python /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python \
  -m pytest -q tests/p1/test_storage.py tests/p1/test_runner.py tests/p1/test_compression.py

UV_CACHE_DIR=/home/hermes/.hermes/profiles/jamie/cache/scratch/uv-p1 \
uv run --no-project --offline \
  --python /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python \
  tests/p1/history_acceptance_gate.py
```

诊断测试最近结果：`7 passed`；严格 gate 按预期退出 `1`，列出历史 API 501 和四条序列不等，详见 [gate.json](evidence/gate.json)。诊断测试通过不代表第一 gate 通过。测试创建的临时 `HOME` 在每项结束清理；证据 JSON 保留在本目录。
