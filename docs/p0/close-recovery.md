# P0 reliable sync / recovery 收口；P1 只规划

基线 Hermes `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`，只读；本次只新增本文与 `probes/p0/close-recovery/`。不部署、不启用活动插件、不调用付费模型或真实工具。已有分路结论见 [汇总](plugin-summary.md)、[历史](plugin-history.md)、[Room 存储](rooms.md)、[真实 runner](plugin-e2e.md)。**结论：现有 `groups.*` 的同一宿主服务确实能提供持久接收、日志、游标、故障后重建部分尚未入队的 Discussion 工作；不能直接认定它已是 App 的单用户 Thread 服务，更不能把 `groups.send` 回执当作 Agent 完成或 exactly-once 副作用。**

## 可复验执行与观测

固定基线 `.venv`，`env -i` 清空凭据，`HOME/HERMES_HOME` 仅位于 profile scratch 的自动销毁临时目录，`TIRITH_ENABLED=false`；没有修改/monkeypatch 核心，唯一替身是通过 service 的 `rpc/runtime.rpc` 注入无模型、无工具、只返回合成 terminal 的 executor。实际调用 **已安装的 `tui_gateway.server._methods['groups.*']`**、`methods_groups.start_hosted_room_service()` 及真实后台 worker，而非仅直接调用 `hosted_rooms` 存储。`cold`、两个 reader 均是全新 OS Python 进程，重开同一临时 SQLite；两个 reader 独立并发走 `groups.log`，**非真实 TCP/WebSocket、非双 App 客户端**。源码与结果：[probe.py](../../probes/p0/close-recovery/probe.py)、[results.json](../../probes/p0/close-recovery/results.json)、[run.log](../../probes/p0/close-recovery/run.log)。

```sh
cd /opt/projects/jamie/_worktrees/hermes-app/p0-close-recovery
env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 \
  TMPDIR=/home/hermes/.hermes/profiles/jamie/cache/scratch \
  PYTHONPATH=/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline \
  HERMES_TEST_ISOLATION=1 \
  HERMES_HOME=/home/hermes/.hermes/profiles/jamie/cache/scratch/placeholder \
  HOME=/home/hermes/.hermes/profiles/jamie/cache/scratch TIRITH_ENABLED=false \
  /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python \
  probes/p0/close-recovery/probe.py > probes/p0/close-recovery/run.log 2>&1
# exit 0；initial/cold/reader/reader = 0/0/0/0
```

- 首进程 `groups.create` 成功；`groups.send` 同 ID/同 payload 返回序号 1/1；改 payload 被 `4111` 拒绝；新 ID 同文本得新序号（本次 seq 2）。后台 worker 发出 `message.member` 与 `turn.settled`，首次记录一个 synthetic executor submit。**两个发送不等于两个执行**：本次第二事件收到 `room.activity(reason_code=silent_round)`，没有第二个 executor submit；另一轮先行实测中第二条在冷进程才提交。Discussion 的策略/调度粒度不能冒充 App FIFO 用户 turn。
- 冷进程在 `groups.log(limit=2)` 分页得到原始 `[1,2,3,4,5]`、游标 5；重发旧 ID 仍返回 seq 1；未来游标报 `4112`。测试在 worker 停止时仅**故障状态布置**：用现有 `append_event` 植入 `message.user`（本次 seq 6），明确断言该事件尚无 queued/running/settled driver task，随后在同一冷进程新建 hosted service/worker；观察到 `message.member`、`turn.settled` 且 executor 恰提交一次该事件。故此证明服务重新启动可从已接收日志补建任务，**不是**在 `send()` 两次提交之间真的 SIGKILL 的实验，也不是跨 OS 进程的该特定 gap 注入。
- 两个独立 reader PID 的完整序号都从原日志前缀继续至本次 cursor 9；复验 `checks` 四项 true。临时 DB/HOME 在父进程退出时自动清理。SQLite 3.50.4 WAL-reset guard 发警告并选择 DELETE journal；不能据此推生产 WAL/多 profile 隔离。
- 一次先行失败已保存 [failed-attempt.json](../../probes/p0/close-recovery/failed-attempt.json)：探针错误地要求两个近同时发送在 12s 内都得到独立 terminal，超时，但日志已有首条 terminal；调整为只断言至少一条已终态、冷进程核查余下工作，不把失败抹成通过。调用 `uv` 的隔离 shell 起初因 asdf shim 的 `env -i` 返回 126、空日志，改用基线现有解释器直启（没有安装依赖）。

定向上游测试（同样隔离 HOME，完整 env/node list 见 [run-tests.sh](../../probes/p0/close-recovery/run-tests.sh)；原始输出 [upstream-tests.log](../../probes/p0/close-recovery/upstream-tests.log)）**19 passed in 4.01s，退出 0**。命令：

```sh
cd /opt/projects/jamie/_worktrees/hermes-app/p0-close-recovery
sh probes/p0/close-recovery/run-tests.sh
```

覆盖 groups RPC 去重、service terminal 重启发布、未知运行重试保护/待审状态、审批迟到选择、cron claimed/未 claimed 恢复与 live delivery 确认。

## 复用判定与边界

**选择 P1 最小插件自有 *acceptance/outbox 元数据桥*，不把 hosted_rooms 整套 Discussion 原样作为 App Thread 权威。** 正式插件边界：`PluginContext.register_platform` 注册 adapter（基线 `hermes_cli/plugins.py:788-818`），真实 runner 为 adapter 装配处理器（`gateway/run_adapters.py:1139-1158`）；dashboard 插件 APIRouter 可在 Python 端 import 代码但须 allowlist，`website/docs/developer-guide/desktop-plugin-sdk.md:794-859` 明言 OAuth remote WS 可能不可用、要 polling fallback。此前 [plugin-history](plugin-history.md) 的 HTTP 挂载已验证。`groups.*` 在 `tui_gateway/methods_groups.py:356-393,487-493` 是 **gateway 内建 RPC**，没有发现平台插件直接挂接其原子事务、注册新 TUI RPC 方法、替换 Discussion 策略的受支持接口；**Python 内部模块可 import ≠ 稳定插件 API**。本探针调用已安装方法为服务行为的边界验证，不是为 App 插件取得了公开内调用授权。

可复用现有行为：Room 的幂等事件/受限分页、driver admission/fence/故障后 policy 重建。`HostedRoomService.send` 先写事件再 `prepare_room`/wakeup（`tui_gateway/hosted_room_service.py:454-466`），`prepare_room` 从 snapshot 恢复终态、选任务、独立 `admit_task`（同文件 `409-437`；`gateway/hosted_room_driver.py:582-604`）；启动会从本机 room bindings 重建 worker（service `64-99,140-169`）。**因此先前两提交窗口是可由服务补偿的局部间隙，不是“所有 Hermes 都无恢复”；但发送后 worker 停止/策略异常/超时仍有 accepted→未执行时段，回执 `driver_started: true` 只是调用返回（`methods_groups.py:381-393`），不能当最终执行证明。** 异常落在已有不确定 running 尝试时，定向测试验证不盲重提（`test_hosted_room_driver_runtime.py:839-895,898-956`）；显式 retry 仅 indeterminate/deferred（service `490-496`）。

不能直接套用的理由：`hosted_room_discussion.py:25-38,253-270` 要求多人 roster、`@handle` 策略与有界 rounds/messages；上述观察中两条同文本不同 ID 的完成时序已不等于 App 单线程 FIFO。其隐藏 `Group: <room>` session 经 `HostedRoomServerRPC` 内部 `session.*` / `prompt.submit`、`_hosted_task` 证明协调（`tui_gateway/hosted_room_server_rpc.py:48-89`），但 App 仍需 Project↔稳定 Thread↔SessionDB lineage；Room 控制/消息事件与 SessionDB 不能成为两个互相冲突的聊天正文权威。`groups.log` 有页字节/房间事件容量上限与 disband tombstone，`gateway/hosted_rooms.py:33-45,1140-1189`；无无限历史承诺。P1 比较桥和受支持的 `groups.*` RPC 消费方案，但**不得**借私有调用或修改核心拼装出“原子”保证。

## 按相关条目给 P1 最小动作与验收缺口

| 条目 | P0 可靠结论 / 保证缺口 | P1 最小可验动作（仅规划） |
| --- | --- | --- |
| T04 / H03 双端持久同步 | 服务 log + 冷进程页读与两独立 reader 已实测；不是双真实设备 WS、没测满额裁剪、删除/tombstone、权限与背压；原 `session.events.since` ring512 非持久。 | 插件服务侧选唯一正文权威 SessionDB；桥中持久映射/逻辑 ID/水位与控制事件，限定日志容量，snapshot+cursor+gap/reset 协议；用两真实认证端、断网/重启/过期游标/删除重建及 polling fallback 验收。 |
| H04 / E01 收据与入队 | RPC 同 ID 去重，服务可恢复已接收未入队事件（布置间隙）；但 event→driver 是两提交，`accepted` 非终态，新 ID 也可能按 Discussion 策略不执行。实际 SIGKILL 窗口未跑。 | 桥持久接收 ID、source→任务状态、扫描式 outbox 补偿和每阶段回执；启动 reconcile 正文/会话状态与任务，实测插入故障点、重启只生成一次可执行 admission；不宣称外部工具 exactly-once。 |
| H01 / H02 / H05 / H06 | Room 不提供 App Project/Thread/lineage 权限模型、跨压缩稳定分页、已读/搜索或删除级联；老插件探针的 HTTP 与 cursor 元数据只证明局部能力。 | 桥仅存 Thread 映射、收据、游标/投递状态和引用；原文仍由 SessionDB 权威持有。定义逻辑 ID 与压缩去重、有界页、按 owner ACL 的 unread/search、删除/导出/保留治理；不复制第二权威 transcript。 |
| E03 / E04 离线执行、失败 | Discussion worker 在断客户端时运行且启动可补建未入队事件；真实 runner 的已有短时 TCP 断线见 `plugin-e2e.md`。本次 executor 是合成；服务间隙注入非真实 kill，未知 running 结果不能重跑工具。 | 用 plugin adapter + 受限队列/状态桥串起来，验证冷崩溃后的 queued/started/settled/unknown 四态与明确人工 retry/fence，满载/超时/停止公平性；合成模型后仍需可观测工具副作用案例，不能自动重提 unknown。 |
| E05 审批/澄清 | `tools/approval.py:125-172,192-206` 的等待者与 first-response-wins 在进程内；`methods_prompt.py:1205-1249` stale live sid fallback **不等于冷重启恢复**；Room `approve_room_task` 严格匹配 request/task/generation，pending actions 仅内存（service `305-311,498-555`）。定向 approval tests 通过。 | 持久 UI 卡片 ID/有效期与代际；跨端 CAS 决议+撤卡，冷重启旧卡失效或重新发起，不能把旧 once 授权新 execution；澄清同规则。 |
| E06 cron / 通知 | `cron/delivery_queue.py:1-7,163-201,225-251,279-312` 有 durable handoff；未 claim 可后送，已 claim 后死机归 `unknown` 且**不重送**；live adapter 成功但无消息 ID 可告警 unverified（定向 19 tests 含该组）。这不是 App 历史或推送验收。 | cron/result 与 Thread 映射写权威历史/元数据，独立设备推送只唤醒；收到终态仍按 cursor 拉取，`unknown` 暴露人工核对。真实 scheduler fire、后台 watcher 与手机 APNs/FCM 留设备验收。 |

## 未解决及停止点

无真实 WS 双端、代理/OAuth remote、真机推送、满额日志、并发跨 profile 授权、真实 SessionDB+Room 共识事务/工具副作用测试；不把本地 synthetic executor 的结果等同真实 Agent。此 P0 证据足以选 P1 插件桥的最小切片与失败规则，但**不足以声明产品可靠同步已实现**。本轮不创建 P1 服务、不改 Hermes 源码、不关闭任务卡。
