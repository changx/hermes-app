# P1-01/02 第一 gate：插件原始行引用历史

日期：2026-09-25。**P1-02 本地历史 gate 通过**；等待主控复核，不据此自行启动 P1-03。验证只使用隔离 profile、只读 Hermes 基线 `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`、真实 GatewayRunner/AIAgent/plugin loader、loopback 合成模型和合成工具。未修改核心、安装活动 profile、调用付费模型或部署。

## 实现与边界

- Channel Description 仅在全新用户 Session 初始化时由正式 prompt section 消费一次；压缩、idle、物理 successor、冷恢复和 prompt rebuild 均不由插件补入。
- Thread 元数据库只保存原始 SessionDB 行引用及执行状态，不复制聊天正文。插件历史按原始行身份读取原文；压缩产生的拷贝行不当作新的用户消息。相同正文的独立发送保留独立 ID。
- `post_llm_call` 保存可见原始行；Gateway adapter 保持 ingress busy 直到其确切后台 owner task 完成，再用入站 `platform_message_id` 找到用户原始行，补全这一轮的可见 user/assistant 行。原始行即使被压缩设为 inactive 也保留引用。正式 Hook 记录的执行结果只有有证据时才是 complete；缺少成功证据的晚写轮次显式为 unknown。`on_session_end` 不再按任意最近用户行猜测 provenance。
- `GET /v1/threads/{id}/messages` 有界分页，使用与核心 TUI 相同的可见文本投影，解析 SessionDB 中 JSON 字符串形式的 `tool_calls` 和 `display_metadata`。内部摘要载体、`session_meta`、hidden 和空内容不进入普通消息；原始引用缺失返回 409。运行期间已持久原文可读，`incomplete_turns` 在 owner task 完成前保持非空。
- 发送仍是 `202 dispatched_volatile`、`durable:false`，并发普通发送返回 409。崩溃后的持久接收/队列、同步游标、审批和附件属于后续任务；本 gate 不证明这些能力。

## 实测证据

- [in-place](evidence/runner.json)、[idle](evidence/runner-idle.json)、[rotation](evidence/runner-rotate.json)：两个 loopback 客户端、Thread 隔离、重复正文、分页、压缩前后同一原始行序列、冷子进程重读、续接后追加、Description 一次语义和缺失原始行 409。
- [自动 preflight](evidence/runner-preflight.json)与[独立两次重跑](evidence/runner-preflight-repeat.json)：真实辅助摘要请求由 `pre_auxiliary_call` 记录，核心原始行转 inactive 后仍完整读取；后续发送及冷重读保持原始 ID 顺序，所有 ingress 结算。先前[未结算回归](evidence/runner-preflight-regression.json)保留为修复前反例。
- [midturn](evidence/runner-midturn.json)：实际合成工具 handler 留下执行标记，正式辅助 Hook 记录 post-tool 压缩请求；工具轮次 user、interim assistant、final assistant 原始行顺序一致，含有界分页、冷重读、Thread 隔离和 inactive 原始行。[请求诊断](evidence/runner-midturn-attempt.json)保留工具结果长度及辅助任务类别。
- [早期 HTTP 400](evidence/runner-failed.json)：gateway 晚写的原始用户行及可见失败提示均出现在插件 GET 中，结果为 unknown，且不留 pending ingress。[原始诊断](evidence/runner-failed-attempt.json)记录核心行与插件行核对。
- [post-hook 竞态](evidence/runner-race.json)：合成 Hook 在历史已记录后阻住真实 gateway owner task；GET 保持 incomplete，紧接的普通 POST 返回 409；释放 task 后下一次发送成功且无合并或重复。
- [严格 gate](evidence/gate.json)：读取上述本次运行证据，`passed: true`、`failures: []`。旧核心投影[负例](evidence/compression-inplace.json)仍保留，不拿插件结果覆盖核心历史差异。

## 重跑

```sh
cd /opt/projects/jamie/_worktrees/hermes-app/p1-foundation
TMPDIR=/home/hermes/.hermes/profiles/jamie/cache/scratch UV_CACHE_DIR=/home/hermes/.hermes/profiles/jamie/cache/scratch/uv-p1 \
uv run --no-project --offline --python /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python -m pytest -q tests/p1

TMPDIR=/home/hermes/.hermes/profiles/jamie/cache/scratch UV_CACHE_DIR=/home/hermes/.hermes/profiles/jamie/cache/scratch/uv-p1 \
uv run --no-project --offline --python /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python tests/p1/history_acceptance_gate.py
```

完整本地测试为 **20 passed**；严格 gate 为 **passed: true**。loopback socket 需允许本地网络。进程崩溃恢复与真实设备验收不在此 gate 内。
