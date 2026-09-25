# P0 TRANSPORT：插件边界实测（T01–T06）

固定 Hermes 基线：`2f16a1aa5a35feec496949abdef7ad51aea0e7ef`；App 分支 `p0/plugin-transport`。仅在 App 仓库新增一次性 fixture、驱动及证据；**未修改 Hermes 核心**。官方插件指南：https://hermes-agent.nousresearch.com/docs/developer-guide/plugins/ 。本报告不代表 P1 服务端或移动端已交付。

## 复现与输出

```bash
cd /opt/projects/jamie/_worktrees/hermes-app/p0-plugin-transport
env -i PATH=/usr/local/bin:/usr/bin:/bin TMPDIR="$TMPDIR" PYTHONDONTWRITEBYTECODE=1 PYTHONNOUSERSITE=1 \
  /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python \
  probes/p0/plugin-transport/run.py probes/p0/plugin-transport/results.json

cd /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline
env -i PATH=/usr/local/bin:/usr/bin:/bin TMPDIR="$TMPDIR" PYTHONDONTWRITEBYTECODE=1 PYTHONNOUSERSITE=1 \
  PYTEST_ADDOPTS='-p no:cacheprovider' .venv/bin/python -m pytest -q -o addopts= \
  tests/hermes_cli/test_plugin_ownership_ledger.py tests/gateway/test_browser_control_artifacts.py
```

实际驱动标准输出：`{"assertions_passed": 22, "checks": ["T01_manifest_register", "T01_factory", "T01_connect", "T02_plugin_http", "T03_http_auth_profile", "T03_ws_auth_profile", "T04_dual_ws_fanout", "T04_remaining_online", "T04_reconnect_replay", "T05_upload_download", "T05_attachment_boundaries", "T01_disconnect", "T02_existing_api_start", "T02_plugin_on_existing_listener", "T02_T03_existing_api_auth", "T05_existing_artifact_upload", "T05_existing_artifact_one_shot", "T05_existing_artifact_type", "T01_disable", "T01_reenable", "T03_registry_profile_isolation", "T06_core_rpc_not_registered"], "temporary_home_removed": true}`。官方定向回归：`55 passed in 4.43s`。逐断言响应在 [results.json](../../probes/p0/plugin-transport/results.json)；计数由实际 append 的断言计算，不手填。

驱动以干净环境启动，在 `$TMPDIR` 下建临时 HOME/HERMES_HOME，复制真实 `plugin.yaml` + `register(ctx)` 包，由真实 `get_plugin_manager().discover_and_load()` 装载，调用 `platform_registry.create_adapter()` 和 `connect()`。仅 `127.0.0.1:0` 监听；两个合成 Bearer 身份，无真实凭据、消息、模型或外网。Hermes API Server 也是真实 `APIServerAdapter.connect()` 临时监听；脚本 finally 停止两个 adapter，卸载插件，删除临时 profile/SQLite 文件。基线 SQLite 3.50.4 输出 WAL-reset 警告并自动改用 DELETE journal；不是本探针造成的测试失败。禁用/启用只更新隔离配置，不碰活动 profile。测试中没有替换或 patch 核心方法。

## 各项判断

| 项 | 分类 | 证据与边界 |
| --- | --- | --- |
| T01 加载、启动、关闭 | **实测插件扩展路径** | manifest discovery → `register(ctx)` → `register_platform` → factory → adapter `connect`；`disconnect` 后 TCP 无法连接、socket/文件内存清空；`discover_and_load(force=True)` 禁用移除注册、重新启用恢复。**注册卸载与已启动 adapter 的网络关闭是两件事**：脚本显式调用 `disconnect()`；未证明单独禁用插件就自动停止现有 GatewayRunner adapter。 |
| T02 HTTP/WS/RPC 入口 | **实测已有 + 实测插件扩展** | 现有 API `/health`=200、认证 `/api/sessions`=200；插件专有监听 `/health`=200、`/ws` 双端真实 WebSocket 升级；`ctx.register_platform_handler("api_server", factory)` 在原有 API listener 上**真实注册** `/p0/transport`，正确 token 200、缺失/错误 401。TUI 核心 WS `/api/ws` 路径见 `tui_gateway/ws.py` 和普通 session 已有独立实测 [transport.md](transport.md)，本次未重新以正式 Dashboard 升级认证跑它。插件 route 非自动获得核心 API key 校验；fixture 明确自行校验，不能视为权限继承。 |
| T03 认证与身份 | **实测已有 + 实测插件边界** | 插件 HTTP/WS：缺失/错误 token 401，合成外人 token 403，伪造 `X-Profile: foreign` 403；原生 API `/api/sessions` 缺失/错误 401、合法 200、未服务 `/p/foreign/...` 404；切换隔离 HERMES_HOME 后平台注册不可见。插件身份策略只是本 fixture 的示例逻辑，未证明平台自带多用户授权、真实配对或任意 profile 的端到端主体隔离。单 owner 多设备可行，多人协作不是当前保证。插件代码在宿主进程**完全信任**，上述校验不能充当沙箱。 |
| T04 双端、重连、通知 | **实测插件扩展路径** | 插件自身 `/events` 发布 seq=1 两条网络 WS 都收到；B 断开后 A 收到 seq=2；B 新建 WS 从 cursor=1 补到 seq=2，`truncated=false`。事件由本插件合成且 ring 只有 8 条，**不是 Hermes Agent 的真实 stream/final/cron 事件**，没有跨进程持久回放、授权事件总线或推送；应接入合适的正式事件/历史接口后重测。 |
| T05 附件 | **实测已有受限能力 + 实测插件原型** | 原生 `/v1/artifacts/upload` 在 browser.extension_control.enabled 下缺 auth 401、`text/plain` 上传 201、下载 200、重复一次性下载 404、错误 MIME 415；它是浏览器控制的短期一次性工件，**不能当聊天附件持久引用**。插件自有 loopback `/files` 原型测试 201/200，以及超 16 字节 413、错误 MIME 415、遍历文件名 400、无 auth 401、外人/伪 profile 403、未知 ID 404。仅内存保存合成字节，不是 P1 文件服务；持久生命周期、Thread 绑定、上传后授权、扫描/配额/迁移均未具备。 |
| T06 核心 RPC 扩展 | **扩展点不足（核心 RPC）；替代已实测** | `PluginContext` 提供 `register_platform`、`register_platform_handler`，但没有公开 `register_rpc_method`；`tui_gateway/rpc_dispatch.py:22-24` 按内建 `_methods` 查找，探针调用原始 `server.handle_request` 的 `app.probe.ping` 返回 JSON-RPC `-32601`。这一步不是网络 WS 请求；不能声称所有可能内部改表方案不可能，只是**无正式插件 API**。不改核心的替代：上述插件拥有的独立 HTTP/WS，或在 `api_server` native handler factory 内新增插件 HTTP route；不能冒充已有 JSON-RPC method。 |

`fixture/__init__.py` 中的 `BasePlatformAdapter` / `Platform` 是 Hermes 提供的平台适配基类（注册走正式 ctx API）；在 `run.py` 中导入 `PluginManager`、`platform_registry`、`APIServerAdapter`、`tui_gateway.server` 是**探针内部测试调用**，不等于对外稳定插件 API。`register_platform_handler("api_server", ...)` 的 native 对象是 aiohttp app；插件必须自己处理新增路由的认证、限流、作用域和生命周期，不能依赖 private 内部函数。独立插件监听也要在部署时明确端口、TLS、主体验证和生命周期所有权；本验证没有暴露远端。

未测：插件路由在真实 gateway 多 profile multiplex 下的授权、生产级附件、跨进程持久通知、真实消息/模型、正式 Dashboard WS 升级认证、手机和进程崩溃恢复。上述限制不是其他 lane 对历史/执行能力的否定。
