# P0 EXECUTION / PROMPTS / ASYNC（仅插件）

> 历史诊断记录：下文 E02 的逐 turn prompt 方案已被 Jamie 后续要求取代，不能用于 P1 实现。当前规则是仅全新用户 Session 初始化注入一次 Description；时间/长度/idle 压缩、物理 successor、冷恢复和 prompt rebuild 后插件均不补入。以 `../p1-plan.md` 为当前需求。

基线 Hermes **只读** `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`，App 起点 `16b1858`。探针在 `probes/p0/plugin-execution/`；[机器结果](../../probes/p0/plugin-execution/results.json)。只复制测试插件到临时 `HERMES_HOME/plugins/`，通过**真实** `get_plugin_manager().discover_and_load()` → `PluginContext.register_platform()` → `platform_registry.create_adapter()` 加载；`BasePlatformAdapter.handle_message()` 执行真实的任务 guard / pending / send / error 分支。**模型/runner 处理器是明确的合成替身**：使用正式 `set_message_handler` 接口绑定；没有实例化真实 `GatewayRunner` 或 `AIAgent`，没有网络监听、真实客户端、工具调用、真实 cron fire 或推送商服务。不能把该替身验证解释为真实 Agent 的执行/持久性证明。不修改、不 monkeypatch Hermes 核心。

## 复现

```sh
cd /opt/projects/jamie/hermes-app
sandbox=$(mktemp -d "$TMPDIR/p0-execution-env-XXXXXX")
# 执行完仅删除本命令创建的 sandbox；临时 DB/插件由脚本 TemporaryDirectory 自动清理
set -eu
trap 'rm -rf "$sandbox"' EXIT
env -i HOME="$sandbox" HERMES_HOME="$sandbox/hermes" XDG_CONFIG_HOME="$sandbox/xdg" \
  TMPDIR="$TMPDIR" PATH="$PATH" \
  PYTHONPATH=/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline \
  PYTHONDONTWRITEBYTECODE=1 \
  /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python \
  probes/p0/plugin-execution/probe.py
```

实际退出码 **0**；stdout `PASS E01 E02 E03 E05 E06-boundary; E04 not proven`。预期 stderr 有合成 `RuntimeError: synthetic failure` 的真实 base-adapter 错误路径日志，以及隔离 SQLite 3.50.4 的 WAL-reset 警告（Hermes 自行降级 DELETE journal；未改共享 venv）。测试限时：活动/排队和停止各 ≤5 秒、cron 发送 ≤8 秒、崩溃子进程 ≤20 秒；`TemporaryDirectory` 回收 DB，崩溃子进程退出码 73，所有本 lane task/thread 无残留。`results.json` 中所有内容为合成文本。

## E01–E06 状态

| 项 | 本次观测与证据 | 仍缺/最低插件路线 |
|---|---|---|
| **E01 插件入站** | **实测已有插件路径**。user-plugin manifest allowlist 启用，registry factory 创建子类，合成 `MessageEvent` 经 `receive → handle_message → background handler → send`；`unload` 清 registry、disabled manifest 重新 discovery 不加载。结果 `loader`, `adapter.delivered`；实现见 `plugin/adapter.py::register/ProbeAdapter.receive`。Hermes `hermes_cli/plugins_discovery.py::gate_manifest` 232–286、`hermes_cli/plugins.py::PluginContext.register_platform` 789–818、`gateway/run_adapters.py::_wire_adapter_handlers` 1139–1159 与 `_instantiate_adapter` 1657–1675。 | 这里接入 callback 是**合成**，非 gateway runner；生产最低路线是同样的自有 `BasePlatformAdapter`，让正常 gateway 启动安装 runner callback，adapter 自行实现有认证/权限和限额的通信入口；不重写 Agent。不证明端到端真实推理。 |
| **E02 Description** | **实测下游装配，非模型/压缩实测**。A 的两轮 prompt=`Channel A description`；t2 显式覆盖，B=`Channel B description`，没有串线；`prompts.first_second_fresh`。Hermes `base.py::resolve_channel_prompt` 1765–1775，`event.py::MessageEvent.channel_prompt` 73–79，`run_turn_runner.py::_combined_ephemeral_prompt` 1850–1864、`_build_fresh_agent` 1102–1123 把它交到 `ephemeral_system_prompt`；`run_agent_cache.py::_agent_config_signature` 95–136 以 prompt 构造缓存签名。 | 这里的第三次仅为“fresh 装配模拟”，**未运行真实 compaction、缓存 AIAgent、模型请求**。Project Description→config map 并非现成自动桥：插件需权威 Channel/Thread 描述来源、每 turn 快照、变更生效边界，复用 `MessageEvent.channel_prompt`；不能在动态配置更新时假定缓存前缀稳定。先前隔离压缩/显示证据见 `docs/p0/history.md` 24、30–31。 |
| **E03 全端离线** | **实测 adapter 内任务，不是断网**。`slow` 在没有测试网络客户端的环境仍 active；同一 thread 的 `second` 被暂存并随后送达，独立 thread 不混；`cancel_session_processing` 确实停止了待决合成任务并无残留。源码 `base.py::handle_message` 3890–3930、`_handle_message_while_active` 3932–4004、`cancel_session_processing` 3830–3855。 | 没有实际掉线网络连接、真实 runner 的 stop/steer、超时/成本/资源上限或多进程 owner 证明。base pending 是内存槽/可能合并文本，不能承诺 durable FIFO；需插件服务器拥有的有界 admission/队列与授权停止、可重建状态，而非全局关回收；普通 TUI session 回收边界参见 `docs/p0/transport.md` 32、42。 |
| **E04 stream/final/error + 故障** | **仅合成 error 发送、崩溃边界实测；核心目标未通过**。合成 handler 抛异常后，base 通过 `send()` 发到正确 t4，`synthetic_error_delivery_count=1`；子进程在 adapter admission 后 exit 73；本探针文件 `accepted-marker` 非 Hermes 收据，不自动重试。`base.py::_process_message_background` 4369–4472、`_notify_turn_error` 4227–4248。Hermes `base.py::_record_delivery_obligation` 4061–4093 仅 final send 前的 best-effort outbound ledger，不等于持久执行接收/stream/history；`run_startup.py::_schedule_resume_pending_sessions` 574–621 有带窗口的重启 auto-resume 路径。 | 未证明真实运行中的模型/工具/副作用故障后完整 stream/final/error 与权威 Thread 历史原子耦合；在此边界，**不可**对不明结果盲自动重跑副作用任务。最小插件方案须持久执行状态/幂等 key/不确定结果人工核对，与 Hermes 会话历史联动；常规 `prompt.submit` 非去重/跨重启事件回放参见 `docs/p0/transport.md` 33–43。 |
| **E05 审批/clarify** | **真实进程内队列和插件 observer hook 实测**：两个候选答复先 `once` 后 `deny`，决议数 1/0；插件 `register_hook(pre_approval_request/post_approval_response)` 真正收到了 `pre`/`post=once`（只观察不授权）；clarify typed `1`→`yes`，迟到答复 False；短超时后 late=False。见 `results.json::approvals/clarify`；`hermes_cli/plugins.py::PluginContext.register_hook` 912–934、`tools/approval_context.py::_fire_approval_hook` 53–72、`tools/approval.py::resolve_gateway_approval` 138–172、`list_gateway_approvals` 192–206，`tools/approval_gateway_wait.py::_await_gateway_decision` 130–220（settle 回调可发 `resolved` cancel），`tools/clarify_gateway.py::wait_for_response/resolve_gateway_clarify` 58–98。 | 未测试真实双设备 UI / socket、离线卡片重开、另端即时撤卡或进程重启后的待审恢复；两种队列均内存态，observer hook **不能**替代决议存储。plugin 需持久 prompt 记录、到期处置、认证后的 first-response-wins compare-and-set、跨端撤卡/重新拉取；不可把过程内列表误认跨重启持久审批。 |
| **E06 cron/后台通知** | **实测 Cron 已有到插件平台的发送路径**。`cron.scheduler_delivery::_resolve_delivery_targets` `origin` 定位 `p0_execution/a/t1`，`local` 空；`_deliver_result` 实际走 live adapter `send`，metadata.thread_id=`t1`、内容含 synthetic-cron-output。`results.json::cron/cron_live_send`。源码 `cron/scheduler_delivery.py::_plugin_cron_env_var` 411–426、`_resolve_single_delivery_target` 612–692、`_deliver_result/_deliver_single_result` 2021–2089、2193–2211。后台 completion watcher 的内部 wake→adapter 路径见 `gateway/run_notifications.py::_inject_watch_notification` 1323–1348、`_deliver_completion_notification_scoped` 1569–1618。 | 没有真正 cron 调度器 fire、长期离线终端历史镜像（`_cron_mirror_delivery_enabled` 103–118 默认关闭）、background completion 全链路或 APNs/FCM 真机。最低插件路线复用 cron target/send hook 与 watcher ingress，显式决定结果入权威历史与认证的通知目标；推送只作为唤醒，不能充当可恢复正文。 |

结论：**插件注册 + 自有 adapter 是干净扩展点**，但 E02 的真实 compaction/模型，E03 服务端跨客户端运行所有权和资源界限，E04 历史/执行原子性，E05 跨重启多端审批，E06 手机推送仍未有端到端证据。既不以本 probe 的合成 handler 补 core，也不将现有 best-effort notification 视作可靠同步。
