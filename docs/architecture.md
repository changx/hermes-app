# 架构与复用评估

## 1. 责任划分

```text
桌面 App       手机 App
     \         /
   共享通信、缓存与同步逻辑
             |
   现有接口 / Hermes App plugin 通信入口
             |
 Channel / Thread / 可见历史 / 同步状态
             |
 Hermes Session / Agent / 工具 / 后台任务
```

服务端能力由 Hermes 及其 plugin 承接，不修改 Hermes 核心源码。adapter 只做认证、输入输出转换、连接与事件投递；新增业务能力放在插件中，通过已有接口和正式扩展点接入。同步规则和权威状态不放在客户端；缓存不成为另一份业务真相。

插件代码独立维护；不使用 monkey patch、复制修改核心模块或客户端专用 fork。具体路由、执行生命周期、历史读取、提示注入和事件扩展点仍需验证，不能假定现有 plugin API 已覆盖全部需求。缺少扩展点时先报告限制和替代方案，不以修改核心补齐。必要的插件元数据由插件管理，不擅自修改核心数据库 schema，不另建重复的权威会话历史。

用户可见的 Thread 关联底层 session lineage，但生命周期不受压缩或物理 session ID 变化影响。用户可见历史与模型请求历史分开读取；复用现有显示投影，而不是简单显示 raw transcript。

## 2. 现有代码证据

检查环境：`/home/hermes/.hermes/hermes-agent`；文档建立时 HEAD 为 `d124b9e685ca6f04c7130373f7861b8f5e79be04`。以下来自本次源码检查，不代表已做端到端验证；本机可能有其他任务修改，正式开发应记录独立基线和差异。

- `tui_gateway/ws.py`：WebSocket JSON-RPC，共用 RPC handler；通常由宿主挂载 `/api/ws`。这是客户端接入首选，不等于 API Server 的端口或认证自动可用。
- `tui_gateway/methods_projects.py`、`hermes_cli/projects_db.py`：profile 级项目 CRUD、多目录、描述等基础；不是完整 Channel / Thread 语义。
- `tui_gateway/methods_session.py`、`session_history.py`：模型与展示历史区分、祖先历史恢复、隐藏记录过滤、compaction 显示处理。须验证 idle compaction 和所有恢复路径的一致性。
- `tui_gateway/event_replay.py`：按会话编号的有界进程内回放，具有重启 epoch；不是跨重启的持久账号级同步日志。
- `tui_gateway/session_lifecycle.py`：最后一个 WS 客户端离开后可触发回收；活跃执行可以延期，但某些条件下会请求中断。不能直接承诺永久后台执行。
- `gateway/platforms/api_server.py`、`api_server_runs.py`：HTTP sessions/runs、SSE、停止/审批等可复用接口；run SSE 消费队列不能当作多端广播日志。
- `plugins/platforms/discord/adapter.py`、`gateway/platforms/event.py`：channel_prompt 与父频道配置继承可参考；不证明 Description UI 到模型的完整新链路已经存在。
- `apps/shared/src/json-rpc-gateway.ts`、`json-rpc-channel.ts`：RPC、心跳、事件与重连恢复，可作为共享 SDK 的起点。
- `apps/desktop/package.json`、`apps/desktop/src/`：Electron/React 桌面应用及现成会话交互。移动端不能直接运行 Electron 依赖；共享范围需实测。

官方参考：
- https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration
- https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server
- https://hermes-agent.nousresearch.com/docs/user-guide/desktop

## 3. P0 后推荐路线（P1-01/02 局部实现；历史生命周期子集已验证）

1. 使用正式 Hermes App platform plugin 接入真实 GatewayRunner，插件自有 HTTP/WS 提供 App 契约；可用核心接口及纯 TS 模块按边界复用。没有正式新增 TUI RPC method 扩展点时，不修改内部 method 表。
2. 通过 Hermes plugin 补 Channel/Thread 的稳定映射、提示继承以及可见历史的统一读取，复用已有能力而不修改核心；模型 compaction 不改用户原文。
3. 明确持久接收、可恢复同步游标、稳定消息 ID、多端通知和阅读状态。优先利用现有持久数据，必要时仅增加最小状态/变更日志；P0 后决定 schema。
4. 界面先消费快照，再衔接增量，处理两者之间竞态；回放有缺口或 epoch 变化时重新同步，不默默跳过。
5. 对已接收任务采用服务端拥有的生命周期；不依赖打开着的窗口。人工停止、超时、重启和离线分别处理。
6. 仅在全新用户会话初始化时将 Channel Description 放入头部一次。后续续聊、冷恢复、时间/长度压缩以及物理 session 续接均沿用 Hermes 自身上下文，插件不补入或恢复 Description 原文快照。既有 Session 的说明更新策略另行明确，不默认热更新；不作为普通聊天正文保存。
7. 主动任务结果进入同一权威历史与同步链路，不只临时发送到某个连接。手机推送不承担正文同步。
8. Hermes 记忆/Skill 自检与 context compression 生命周期由 adapter 识别后写入 plugin 专用系统通知记录，并通过同一 `message_refs`、分页和 `sync_events` 投影到 Thread。它们不写 SessionDB、不作为 assistant 正文；同一次压缩的 preflight、开始、心跳和完成更新稳定 ref，成功完成或失败后重试均使用新 ref。目标必须由 `chat_id + thread_id` 同时校验，不按最近会话猜测。

无需为实现这些语义先引入 Redis、消息队列集群、独立聊天服务或新的通用框架。

## 4. 客户端和发布

P0 推荐桌面 Electron/React、手机 Expo/React Native；Metro Android JS 导出与协议探针已实测，尚无 APK/设备验收，不承诺共享 DOM UI。共享协议、消息归并、缓存规则；平台专属代码负责凭据存储、通知、文件选择、生命周期和打包。依据及 Flutter 取舍见 [移动端结论](p0/close-mobile.md)。

必须产出独立安装包、真实设备证据和受控更新方案。签名/分发权限在发布阶段获得；P0 不要求购买账户或接入真实推送服务。

P0 已复现压缩后的显示顺序/重复差异；旧探针的 physical successor Description 快照恢复要求已被用户纠正，不再属于待补功能；既有低层显示 helper 不可直接当 App 完整时间线。hosted service 的持久恢复可用，但 Discussion 不是逐消息 FIFO。P1 使用最小插件元数据桥和权威 SessionDB，先验证稳定历史，再做可靠同步；见 [P0 收尾](p0/final.md) 与 [P1 计划](p1-plan.md)。

## 5. 重点风险

- 重用现有 session 行 ID 时，压缩/编辑/重写是否改变它：先验证再决定映射，不能直接承诺稳定 ID。
- 历史拼接是否混入摘要、内部 prompt，或发生重复/截断。
- 后台消息是否被投递到错误 Thread/profile，或只存在临时连接队列中。
- 接收确认、执行入队和进程崩溃之间的窗口；必须可恢复且不重复外部副作用。
- RPC 当前可暴露管理能力；独立客户端身份与权限需服务端约束，不把安装包内置为共享管理员凭据。
- 两个独立 runtime 同时写同一 session；本方案多客户端连接同一权威 owner，不等于许可多个进程并行改写。
- 当前生产 Hermes 有其他任务进行；所有验证在独立配置、数据库和工作树中完成。
