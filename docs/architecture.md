# 架构与复用评估

## 1. 责任划分

```text
桌面 App       手机 App
     \         /
   共享通信、缓存与同步逻辑
             |
   Hermes 客户端通信接口
             |
 Channel / Thread / 可见历史 / 同步状态
             |
 Hermes Session / Agent / 工具 / 后台任务
```

服务端能力由 Hermes 承接。adapter 只做认证、输入输出转换、连接与事件投递。同步规则和权威状态不放在客户端；缓存不成为另一份业务真相。

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

## 3. 推荐路线（待 P0 验证）

1. 直接复用现有 WS JSON-RPC 和可复用客户端模块，不开发 Discord wire protocol。
2. 在 Hermes 内补 Channel/Thread 的稳定映射、提示继承以及可见历史的统一读取；模型 compaction 不改用户原文。
3. 明确持久接收、可恢复同步游标、稳定消息 ID、多端通知和阅读状态。优先利用现有持久数据，必要时仅增加最小状态/变更日志；P0 后决定 schema。
4. 界面先消费快照，再衔接增量，处理两者之间竞态；回放有缺口或 epoch 变化时重新同步，不默默跳过。
5. 对已接收任务采用服务端拥有的生命周期；不依赖打开着的窗口。人工停止、超时、重启和离线分别处理。
6. Channel 提示在执行上下文构建时注入。更新生效策略单独明确，不作为第一条聊天正文保存。
7. 主动任务结果进入同一权威历史与同步链路，不只临时发送到某个连接。手机推送不承担正文同步。

无需为实现这些语义先引入 Redis、消息队列集群、独立聊天服务或新的通用框架。

## 4. 客户端和发布

桌面优先验证基于现有 Electron/React 代码的独立产品入口。手机优先验证复用 React/TypeScript 的原生容器方案；是候选而非已批准技术选型。共享协议、消息归并、缓存规则；平台专属代码负责凭据存储、通知、文件选择、生命周期和打包。

必须产出独立安装包、真实设备证据和受控更新方案。签名/分发权限在发布阶段获得；P0 不要求购买账户或接入真实推送服务。

## 5. 重点风险

- 重用现有 session 行 ID 时，压缩/编辑/重写是否改变它：先验证再决定映射，不能直接承诺稳定 ID。
- 历史拼接是否混入摘要、内部 prompt，或发生重复/截断。
- 后台消息是否被投递到错误 Thread/profile，或只存在临时连接队列中。
- 接收确认、执行入队和进程崩溃之间的窗口；必须可恢复且不重复外部副作用。
- RPC 当前可暴露管理能力；独立客户端身份与权限需服务端约束，不把安装包内置为共享管理员凭据。
- 两个独立 runtime 同时写同一 session；本方案多客户端连接同一权威 owner，不等于许可多个进程并行改写。
- 当前生产 Hermes 有其他任务进行；所有验证在独立配置、数据库和工作树中完成。
