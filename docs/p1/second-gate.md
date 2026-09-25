# P1-03 第二 gate：持久接收、恢复与同步

日期：2026-09-25。**本地实现已提交待主控独立复核；卡片保持运行，不由本 worker 关闭。** 固定 Hermes 核心基线 `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`，只读使用；未修改核心、安装活动 profile、部署、推送或调用付费模型。精确 HTTP/WS 契约及源码边界见 [protocol.md](protocol.md)。

## 已实现并实测

- 收据和入队事件同一事务落盘；必须提供 `client_message_id`。并发重试同 ID 返回同一收据，改正文 409；相同正文不同 ID 独立执行。单 Thread FIFO、32 条待处理上限、16 KiB 临时正文；核心原始用户行以 `platform_message_id` 精确关联后清空临时正文。
- 每 Thread 一个实际 Gateway owner；HTTP/WS 客户端关闭不取消执行。正常完成等待 owner task 结束，并核对正式成功 Hook 或精确核心入站行、持久 `finish_reason='stop'`、无 tool call 的 final。真实三工具中途压缩的原始 user/interim/final 行不变，执行结算为 `complete`；复制的压缩用户行不再令其降级为 `unknown`。
- 冷重启只派发 `queued`。正在运行的旧收据为 `unknown`，不重跑模型或工具；核心启动时内部空 resume 事件只在本 adapter 被拒绝，其他平台不受影响。持久 final 在 App Hook 前崩溃时，恢复按原始核心行补唯一可见引用和事件，保留 `unknown`，不把单独存在的 assistant 行猜成成功。
- 全局持久事件、HTTP 有界快照及分页、WS 同日志重放、外 profile/未来游标 400、慢客户端有界缓冲、单 owner 单调已读。长离线 525 条新增事件完整回放；第二设备看到实际可见消息计数与已读位置。凭据轮换后旧 WS 关闭，旧凭据 HTTP 401；停用释放 listener 和任务。

## 真实故障窗口

所有下列场景使用真实插件 loader、GatewayRunner、AIAgent、loopback 合成模型、两个 HTTP/WS 客户端和独立 TMPDIR 子进程。父进程只杀自己的隔离子进程；不伪造终态数据库。

| 场景 | 观测 |
| --- | --- |
| 第一请求停在模型门，第二请求已入队后 SIGKILL | 第一收据重启为 `unknown`、模型调用没有重复；第二从队列恢复并 `completed`，核心用户与 final 各一条。[证据](evidence/delivery-queued.json) |
| 合成工具写入并 fsync marker、等待期间 SIGKILL | 重启无第二次工具 marker 或模型调用；同 ID 重试仍返回旧 `unknown`。[证据](evidence/delivery-tool.json) |
| 独立测试插件按已验证 loader 顺序在 App Hook 前的 `post_llm_call` 写 marker 并 `SIGSTOP`；父进程确认核心 final 后 SIGKILL | 重启只发布原 final 引用一次，不调用模型；执行保守 `unknown`。[证据](evidence/delivery-final.json) |
| 客户端断开时模型等待；释放后第二客户端取到 durable final | 后续重连、两 WS、长离线 525 事件、游标拒绝、已读、凭据撤销均通过。[证据](evidence/delivery-offline-sync.json) |

完整 `uv` 运行：`33 passed in 152.71s`（含乱序/重复版本收敛单元测试）。P1-02 严格历史 gate 在本次隔离证据上 `passed:true`、`failures:[]`；三工具 midturn 的 `turn_outcomes` 和 `incomplete_turns` 均为空。[汇总](evidence/p1-03-gate.json)。P1-02 原有证据文件及 `runner-last-failure.log` 的工作树状态保持未提交，避免覆盖其他任务的诊断；本任务只提交新 P1-03 证据。

## 重跑

```sh
cd /opt/projects/jamie/_worktrees/hermes-app/p1-foundation
TMPDIR=/home/hermes/.hermes/profiles/jamie/cache/scratch \
UV_CACHE_DIR=/home/hermes/.hermes/profiles/jamie/cache/scratch/uv-p1 \
P1_EVIDENCE_DIR=/home/hermes/.hermes/profiles/jamie/cache/scratch \
uv run --no-project --offline --python /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python -m pytest -q tests/p1

P1_EVIDENCE_DIR=/home/hermes/.hermes/profiles/jamie/cache/scratch \
uv run --no-project --offline --python /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python tests/p1/history_acceptance_gate.py
```

loopback socket 测试需本地网络权限。P1-04 审批/附件/主动任务以及 P1-05 共享 TS 客户端尚未实现；正式桌面/手机安装包与真机验收仍属后续阶段。生产基线升级后需重验 adapter 对 `GatewayRunner._startup_restore_in_progress` 的私有只读边界。正在运行的外部副作用无法由崩溃后 SessionDB 单独证明完成，故明确报告 `unknown`。
