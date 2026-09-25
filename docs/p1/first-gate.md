# P1-01/02 第一 gate：原始行引用历史

日期：2026-09-25。**P1-02 gate 未通过**。所有执行仅在隔离 profile、固定只读 Hermes 基线 `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`、本地合成模型及 scratch 中进行；没有调用付费模型、安装活动 profile、修改核心或部署。

## 当前实现与边界

- Hermes App plugin 使用正式 platform、prompt section 和 lifecycle hooks。Channel Description 仅全新用户 Session 消费一次；不在压缩、继承 Session、冷恢复或提示重建后补入。
- `post_llm_call` 在 Hook 实际给出原始用户行时，从最后一个用户行开始，按核心 `_row_id` 保存该后缀全部持久、可见的 user/assistant 文本行，包括工具轮次的 interim 助手内容和 user-only 轮次。身份不按正文去重。最后用户行仍是一个需要实跑证明的边界假设；自动 preflight 的重跑失败证明其覆盖不足，不能宣称完整当前轮 provenance。`on_session_end` 在被调用且缺少 post hook 时，按 Session 的后续原始行尝试补回用户行，并将执行结果标为 failed/interrupted/unknown；GatewayRunner 早期失败路径没有触发这一补救。
- `GET /v1/threads/{id}/messages` 只读取当前页所引用的核心行，用 Hermes 既有显示投影转换文本；内部摘要载体、`session_meta`、hidden、空内容和模型/人格切换标记不作为普通消息。原始行丢失、身份失配或被变成不可见内容时返回 409，不用相同正文的另一行替代。页游标绑定 Thread 并验证已存在引用；外来、未来或无效游标返回 400。运行中仍可读取已有历史，同时得到 `incomplete_turns`；失败/中断状态在 `turn_outcomes` 中列出。
- 仍只有 `202 dispatched_volatile`，并发普通发送在 busy Thread 返回 409。异常进程退出后的 ingress 恢复与可靠同步属于 P1-03，不能把本 gate 当作持久接收保证。Thread 列表现按 1–100 条分页；SQLite 连接关闭，listener 和 WebSocket 由 adapter 停止。

## 真实运行结果

- GatewayRunner、两个 loopback HTTP/WS 客户端与本地合成模型实跑 in-place、idle 和物理 rotation；包含重复正文、分页、branch 隔离、原始行删除后的 409、冷子进程重读和下一轮。三条路径通过；证据：[in-place](evidence/runner.json)、[idle](evidence/runner-idle.json)、[rotation](evidence/runner-rotate.json)。
- 自动 preflight 使用核心配置 `compression.threshold_tokens: 2400`。一次定向运行中，实际 AIAgent 的 `context_compressor.threshold_tokens` 为 2400；10 次普通请求之外新增 2 次模型 HTTP 请求，13 条核心原始行变 inactive，插件 GET 的 18 条原始消息和随后第 19/20 条保持 ID/文本顺序，冷进程读取一致；下一轮模型请求中没有 Description 副本。证据：[单次通过](evidence/runner-preflight.json)。但稍后的完整子集重跑在第二次发送后出现未完成映射：HTTP 已返回 202，20 秒轮询后 GET 仍只有首轮两条消息，ingress 和 turn 两个 ID 均为 pending。证据：[重跑回归](evidence/runner-preflight-regression.json)。因此自动 preflight **未得到可重复通过**，不能放行。额外模型请求计数只适用于该单次通过的探针。
- **midturn 仍未通过。** 两次定向真实 GatewayRunner/AIAgent 尝试都调用了正式注册的本地合成工具；interim 和 final 两条助手原文已在插件 GET 中可见。但工具结果进入第二次模型请求时仅有 293 字符，整轮只有 2 次 HTTP 请求，未观察到摘要模型请求。因此未证明 post-tool 自动压缩期间的原始行身份与历史。测试中的 `>=3` 请求断言保留。没有用直接调用 `_compress_context` 代替 midturn 自动路径。
- **失败轮次也未通过。** 两次定向 GatewayRunner 运行中，本地模型对 `P1_FAIL` 返回非重试的 HTTP 400。核心随后持久化了该用户行（第二次为 row 7）及助手失败提示（row 8），但没有可用于插件完成映射的 `post_llm_call`/`on_session_end` 通知；20 秒后插件 GET 仍只返回之前的 2 行，并列出 ingress 和 turn 两个 pending ID。核心先走早退，gateway 再写入 fallback 行；当前正式 Hook 看不到这次晚写。证据：[失败轮次原始行与插件 GET](evidence/runner-failed-attempt.json)。旧历史仍可读，但新用户行未进入连续历史、busy guard 也不会自行解除；这是 P1-02 硬阻塞，不以 P1-03 队列承诺掩盖。
- 源码中 Gateway fallback 用户行带入站 `message_id`，Agent 正常写入也有 `persist_user_platform_id` 路径。可调查以该 provenance 与插件 ingress ID 核对晚写原始行，再由有明确执行结算信号的插件流程补齐引用；这一方案尚未实现或验证，不能靠定时扫描猜测轮次身份。
- `tests/p1/test_history_refs.py` 覆盖 user-only、interim、pending 期间旧历史可读、显式调用 `on_session_end` 时的中断结果、无效游标、结构化文本及内部标记过滤。这些是接口/Hook 层验证，不冒充实际 GatewayRunner 的早期失败路径。

旧 [in-place 原始投影负例](evidence/compression-inplace.json)、[rotation 负例](evidence/compression-rotate.json)、[idle 负例](evidence/compression-idle.json) 与 [in-place idle 负例](evidence/compression-inplace_idle.json) 仍保留，不用插件接口的通过结果抹掉核心投影差异。

## 重跑与判定

```sh
cd /opt/projects/jamie/_worktrees/hermes-app/p1-foundation
TMPDIR=/home/hermes/.hermes/profiles/jamie/cache/scratch UV_CACHE_DIR=/home/hermes/.hermes/profiles/jamie/cache/scratch/uv-p1 \
uv run --no-project --offline --python /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python \
  -m pytest -q tests/p1

TMPDIR=/home/hermes/.hermes/profiles/jamie/cache/scratch UV_CACHE_DIR=/home/hermes/.hermes/profiles/jamie/cache/scratch/uv-p1 \
uv run --no-project --offline --python /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python \
  tests/p1/history_acceptance_gate.py
```

`tests/p1/conftest.py` 固定只读基线和插件 import，并强制所有 pytest scratch 路径；不需要临时 `PYTHONPATH`。真实 loopback socket 需允许本地网络。最后一次广义子集命令 `pytest -q tests/p1 -k 'not midturn and not failed'` 得到 **13 passed, 1 failed, 2 deselected**，失败项为 `[preflight]`；此前 `[midturn]` 与 `[failed]` 各经过两次定向运行且失败。严格 gate 必须退出非零并写出 `passed: false`。P1-03..05 不因此放行。midturn 工具结果为何被缩为 293 字符、preflight 第二轮偶发未映射、GatewayRunner 早期失败后缺少可用晚写通知、附件/多模态完整投影与进程崩溃恢复仍是未完成项。
