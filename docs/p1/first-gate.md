# P1-01/02 第一 gate：插件原始行引用历史

日期：2026-09-25。仅在隔离环境验证；没有安装活动 profile、修改 Hermes 核心、调用付费模型或部署。Hermes 基线固定为 `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`，使用其现有 `.venv`；测试使用隔离 `HOME`/`HERMES_HOME`、本地合成模型和临时数据库。

## 已实现

- Hermes App platform plugin 的 Channel/Thread、单 owner loopback HTTP/WS 与一次性 Description 行为保持不变。仅全新用户 Session 消费 Description；续聊、压缩、物理 successor 和重建提示均不由插件再次注入。
- 正式 `pre_llm_call` 将执行的 `turn_id` 绑定到 Thread；仅核心标记为 compression 的物理子 Session 继承 Thread，`_branched_from` 与 `_reset_from` 被排除。正式 `post_llm_call` 在核心持久化后提取当轮用户/助手 `_row_id`，用同一事务写入插件自有的 `turn_id`、Session ID、核心 row ID 与顺序。`on_session_end` 只有完成状态，不提供行列表，因此不用它猜测身份。插件没有第二份正文、正文哈希去重、核心 schema 变更或触发器。
- `GET /v1/threads/{id}/messages` 按插件顺序键分页，单页限 1–100 条，只按该页 row ID 有界读取权威 SessionDB。每条消息的身份来自原始核心 row ID；相同正文的不同发送保留不同 ID。原始行被删除或失配时返回 409，不回退到同文副本。未完成引用返回 409；P1-03 队列尚未实现，忙碌 Thread 的并发普通发送也返回 409。发送仍仅为 `202 dispatched_volatile`，并非持久接收保证。
- 核心 lifecycle hook 失败是 fail-open；插件以 pending 状态让历史读取 fail-closed。进程异常中断后 pending 仍需后续恢复机制处理，不能把目前的 volatile ingress 当作 P1-03 完成。

## 实测

`tests/p1/test_runner.py` 实际启动 GatewayRunner、两个客户端、AIAgent 和本地合成模型。真实 GatewayRunner 发送多轮消息，包括两次正文完全相同的用户消息与多条相同的助手回复；其后分别执行真实原地压缩、idle 压缩和物理 Session rotation。rotation 后的下一轮由真实 AIAgent 在子 Session 执行。三种模式均比较压缩前、压缩后、再续聊的插件 GET 完整 ID/role/text 顺序，检查 `limit=2` 游标、独立冷子进程重开、另一 Thread 排除和删除原始行后的 409。压缩探针要求实际 summary 模型请求和新 active 行，避免空跑误报。证据：[原地](evidence/runner.json)、[idle](evidence/runner-idle.json)、[rotation](evidence/runner-rotate.json)、[gate](evidence/gate.json)。

旧 [原地](evidence/compression-inplace.json)、[rotation](evidence/compression-rotate.json)、[idle](evidence/compression-idle.json) 与 [原地 idle](evidence/compression-inplace_idle.json) 文件仍记录核心原始显示投影的乱序/重复负例。它们不衡量插件历史接口；gate 单独保留这些负例。

本次隔离测试 `11 passed`，插件历史生命周期**已测子集** gate 退出 0。基线 worktree 前后均为干净状态。`tests/p1/test_history_refs.py` 另检查重复正文、有限分页、外部删除和 branch/reset 分类。

## 尚未覆盖与阶段边界

自动 preflight 与 midturn 压缩期间的 hook `_row_id` 观察尚未形成可重复的真实触发测试；`pre_llm_call` 在 preflight 之后且用户行持久化之前执行，不能直接证明当前用户的压缩前原始 ID。不能把已通过的手动与 idle 压缩推广到这两条路径。曾尝试低阈值与合成高 usage，实际运行没有触发额外 summary 请求，故未计入 gate。模型工具消息、附件/多模态、异常退出时的完整可见行覆盖也未实现。当前只承诺新插件来源的纯文本普通轮次；旧历史导入不在范围内。P1-02 整体尚未完成，P1-03..05 仍未实施。

## 重跑

```sh
TMPDIR=/tmp UV_CACHE_DIR=/tmp/p1-uv-cache PYTHONPATH=/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline:/opt/projects/jamie/_worktrees/hermes-app/p1-foundation/plugins \
uv run --no-project --offline --python /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python \
  -m pytest tests/p1/test_storage.py tests/p1/test_history_refs.py tests/p1/test_runner.py tests/p1/test_compression.py -q

TMPDIR=/tmp UV_CACHE_DIR=/tmp/p1-uv-cache \
uv run --no-project --offline --python /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python \
  tests/p1/history_acceptance_gate.py
```

运行真实 loopback 模型的测试需要允许本地 socket；其余临时 HOME 在测试结束后清理。上述历史读取还不等于最终桌面/手机 App 或生产部署。
