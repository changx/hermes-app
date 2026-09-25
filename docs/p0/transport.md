# P0 / TRANSPORT：普通 session 的 WebSocket 实测

基线：Hermes read-only snapshot `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`；App worktree `p0/transport`。本页**只评价 `tui_gateway.ws.handle_ws` → `session.create` / `session.resume` / `prompt.submit` / `session.events.since` 的普通 session 路径**。Hermes 另有 `tui_gateway/methods_groups.py`、`gateway/hosted_rooms*` 的 durable room identity/log/idempotency 与进程拥有的 discussion service，主任务另行验证；下列缺口**不是对整个 Hermes 的断言**。

## 运行与隔离

```bash
cd /opt/projects/jamie/_worktrees/hermes-app/p0-transport
/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python \
  probes/p0/transport/ws_probe.py --output probes/p0/transport/results.json

cd /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' \
  scripts/run_tests.sh -j 2 --file-timeout 90 \
  tests/tui_gateway/test_tui_gateway_ws.py \
  tests/tui_gateway/test_tui_gateway_event_replay.py \
  tests/tui_gateway/test_protocol.py
```

探针在随机 `127.0.0.1` 端口启动/重启隔离子进程，FastAPI WebSocket 路由**直接调用真实** `handle_ws`；两条真实 TCP WebSocket 以 JSON-RPC 调用 Hermes 注册 handler。合成状态/事件只通过进程内的 loopback-only `/__probe__` 控制路由注入，调用 Hermes 的 `_emit` 与审批队列；HTTP 控制路由**不是 Hermes 提供的 RPC**。子进程环境白名单只包含 PATH、独立的 HOME/HERMES_HOME/XDG/TMPDIR、快照 PYTHONPATH、时区/locale 与临时回收阈值；未继承真实凭据、配置或聊天数据。仅屏蔽模型 Agent 构建 `_schedule_agent_build`，涉及 `prompt.submit` 的测试将外部执行器 `_run_after_agent_ready` 替换为合成活动时钟工作线程；没有模型、工具命令、cron 调用。WS 连接、RPC handler、真实 DB 持久化、fanout、回放、detach/reaper、审批队列均运行真实代码。清理子进程、检验端口关闭，并删除临时 home。为有界测试将断线宽限设为 **1.5 s**、活动过期阈值设为 **0.6 s**；生产默认值分别为源码的 20 s / 600 s，探针不是生产时长性能测量。

机器可读实测证据：[results.json](../../probes/p0/transport/results.json)。

## 实际结果

| 项目 | 观察（均由上述脚本断言） | 证明边界 |
| --- | --- | --- |
| 双端 fanout | 同一存储会话两条连接复用同一 runtime sid；合成 `status.update` 在两端都收到 seq=1 | 真实网络与真实事件路由；内容是合成状态，不是模型输出 |
| 一端断开 / 重连 | 剩余端收到 seq=2；断开端 `session.resume` 后 `session.events.since(last_seen=1)` 补回 `[2]`，`truncated=false` | 同进程短时回放 |
| 多端审批 | 两端收到同一 `srq-*`；第一端 `once` 生效，第二端后发 `deny` 被丢弃；真实 `tools.approval_gateway_wait` 队列也只得到一次 `once` | 合成无害审批数据，未允许执行任何工具；在 0.45 s 有界观察窗口内，另一端**未收到** `request.cancel`，故不能声称其审批卡即时收起；尚需独立 UI/更长时长验证 |
| 有界回放 | 离线注入 530 个事件，当前 session 保留 512，`latest_seq=532`；从 seq=2 补回时 `truncated=true` | 丢弃 sink `written=0` 仍盖章/进入**进程内** ring；标记缺口，而非自动恢复缺失正文 |
| 最后客户端离开 | idle runtime 在宽限后真实回收；`prompt.submit` 获 `streaming` 后，合成 worker 保持新鲜活动，在宽限后的 ticks 从 1→20，仍 alive/running；没有活动的合成 worker 在宽限后收到 interrupt | 断开**不立即**停止健康 turn，也**不是**无限后台执行承诺；没有真实模型/工具副作用，执行器、活动计时均替身 |
| 同 ID 重试 | 同一个 JSON-RPC `id` 在前次合成工作结束后再次 `prompt.submit`，两次均回复 `streaming`，真实 DB 有两条 user 行 | JSON-RPC id 只是请求关联，不是幂等发送 key；不能把 ack 当作 exactly-once 或完成 |
| 进程重启 | 新进程 `gateway.ready.replay_epoch` 不同；旧 sid 从 seq=2 查询返回 0 事件、`truncated=false`；`session.resume` 给新 runtime sid，存储 key 的两条合成 seed 内容仍在真实 DB | 种子历史可恢复；**旧事件回放不可跨进程**，客户端须按 epoch 重新拉权威历史；未测试真实运行中崩溃恢复 |

补充回归：官方 `scripts/run_tests.sh` 对 3 个 TUI gateway 测试文件报告 **88 passed, 0 failed**（2 workers，约 22 s）；它们是单元/协议补充，不能替代以上 loopback 测试。

## P0 结论与后续接口问题（限普通 session 路径）

- **接收/幂等**：`prompt.submit` 的 `streaming` 回复是本进程的执行接入；本探针验证 submit 时用户行写入真实隔离 DB，**未**证明 ACK 丢失后重试只写一次/只执行一次，也未证明持久 admission 与调度之间崩溃窗口的恢复。相同 JSON-RPC id 确实产生第二行。下一阶段需独立的稳定客户端发送 key、服务端去重与持久接收/执行状态；不可从 RPC id 推断。
- **同步范围**：`event_replay.py` 是有限、进程内按 runtime sid 的事件 ring；ring 缺口会报 truncated，但重启后旧 sid 没有 retained watermark，返回 `truncated=false`。epoch 可识别代际；需要以可分页的权威历史/快照重建状态，不能将该 ring 当跨重启账号级变更日志。普通 session 的 session-less 全局事件只有在线广播，尚未实测定时/后台结果的离线持久投递、稳定 Thread 定位和未读/跨设备已读；**不能说 Hermes 全局没有**这些能力。
- **执行生命周期**：当前 reaper 对健康活动延期，对停滞活动执行中断，对 idle 回收；这与无限离线执行不同。合成 worker 的短断线幸存不证明真实 API 等待、工具执行、审批、cron、进程死亡能独立完成。必须以明确超时/资源界限建模任务，并做真实非付费工具及进程故障验证；不能为了离线执行直接关闭回收。
- **审批**：当前内存请求/队列能一答一次，迟到回答不会二次生效；队列实测第一端回答时另端未即时收到 cancel（有限窗口），跨设备卡片最终一致性与进程重启后审批状态仍待验证。没有证明认证/授权范围；探针直接挂 `handle_ws` 而非生产宿主的升级认证中间件。
- **只读/权限边界**：`session.resume` 和回放是连接级读面，不等于身份隔离、只读客户端权限模型或持久增量同步；此 probe 不测认证、异 profile、读状态、cron 实际投递、压缩/历史投影或手机设备。请结合主任务的 hosted rooms/历史/UI 探针决定是否复用已有持久设施，不在本 P0 lane 实施 P1 修复。
