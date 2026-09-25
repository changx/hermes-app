# P1-04 本地实现与第三 gate 候选

状态：已完成主控独立复核与 P1 集成验收，当前结论见 [最终验收](final.md)。以下保留分阶段证据。固定只读 Hermes 基线 `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`，插件未改核心，也未安装活动 profile、调用付费模型、部署或发布。P1-03 原有 Description 只在全新逻辑 Session 注入一次，压缩/续接/冷恢复均不补入。

## 实现范围

- adapter 正式审批/澄清呈现，精确 `request_id`/Thread/收据/进程代际作答，双端竞争和过期失效事件；核心仍负责授权策略和 waiter。停止调用核心硬中断，排队取消单独处理，并释放等待中的审批或澄清。
- 真实 cron scheduler 经 adapter 投递到指定 Thread；核心 SessionDB 保存 assistant 原始行，插件仅保存稳定引用及事件。按核心执行 ID 区分同文运行、幂等重投，启动时补齐“核心行已写、插件引用未写”的窗口。App cron 作业须显式 `attach_to_session=false`。
- 每 Thread 附件原始流上传、持久下载、未附删除、原子更名、安全 MIME/下载头、大小和未附上传配额；`MessageEvent` 向 Agent 传递已有本地路径机制。原文历史仍由 SessionDB 管理。
- 基于已发布可见引用的 Thread 内有界搜索；归档不删原文、附件或幂等收据。旧 P1-03 无附件收据的正文摘要保持原格式，升级后重试兼容。

## 隔离验收

使用固定基线 `.venv/bin/python` 经 `uv run --no-project --offline`，`TMPDIR=/home/hermes/.hermes/profiles/jamie/cache/scratch`，`P1_EVIDENCE_DIR=$TMPDIR/hermes-app-p1-04`。本地测试配置只连接 127.0.0.1 合成模型；真实 `GatewayRunner`、插件加载器、AIAgent、核心审批/澄清 waiter、无付费 no-agent cron 脚本、SessionDB 与两个认证客户端均参与。详细场景：

- 两个 WebSocket 客户端观察同一审批与结算事件；并发作答一个 200、另一个 409；错误选择/Thread/收据/进程代际被拒绝。重启旧审批过期，新运行不被旧按钮放行。停止待答澄清和审批都唤醒核心 waiter。
- 停止阻塞中的本地合成工具，释放前无后续副作用；同 Thread 排队收据单独取消、正文清空，另一 Thread 继续完成。
- 两次真实 scheduler due fire 的相同脚本输出形成两条不同可见引用；同执行重投不增加可见消息；冷读者和同步事件可重放；独立模拟核心行已写但插件引用未写的崩溃窗口，由启动恢复补齐。
- 附件实际传给 Agent 上下文；重启下载字节一致。其他 Thread/未认证、恶意文件名、符号链接、超限及中断上传被拒绝或清理。搜索压缩前原文且不返回公共 Description/内部摘要，归档后仍可读并保持重试幂等。

验收命令：

```bash
uv run --no-project --offline --python /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python -m pytest -q tests/p1
uv run --no-project --offline --python /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python tests/p1/history_acceptance_gate.py
```

证据输出于任务目录；仓库只收纳 `docs/p1/evidence/04*.json` 中的摘要，不提交合成 profile、临时上传、.env 或旧 P1-02 证据变动。测试创建的临时 profile 运行后清理。

2026-09-25 本地结果：完整 `tests/p1` **42 passed in 187.56s**；最终小修后定向 `test_interaction_runner.py` 与 `test_content_store.py` **3 passed in 22.51s**；严格历史 gate `passed:true`、`failures:[]`。摘要见 [04-runner.json](evidence/04-runner.json)、[04-restart.json](evidence/04-restart.json)、[04-strict-gate.json](evidence/04-strict-gate.json)。旧 P1-02 evidence JSON 工作树改动和 `runner-last-failure.log` 是先存资料，未纳入本任务提交。

## 边界

- 核心 cron adapter metadata 仅给 `job_id`，不直接给 `execution_id`；插件从同一 profile 的执行账本取得该 job 最近的运行。隔离测试现在对同一 recurring job 两次实际到期、相同正文与同一次重投分别核验不同引用和幂等。当前核心 scheduler 对同一 job 的认领与投递串行；若未来允许旧执行在新执行运行中向 adapter 重投，现有正式 metadata 无法区分两者。此时不能声称 exactly once，需先有正式执行 ID 传递或停用该投递路径。
- 外部工具副作用不承诺跨进程 exactly once。停止请求经核心硬中断；已开始但最终边界无法证实时沿用 P1-03 `unknown`，不自动重跑。
- 未附上传按 Thread 配额限制并由用户显式删除；启动仅清理本插件命名的中断临时文件和无元数据孤儿。归档历史和已附附件不会自动删除。本阶段没有新的破坏性历史删除功能。
