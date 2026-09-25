# P0：仅插件 HISTORY / DOMAIN / SYNC 验证

基线 Hermes `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`（只读）；本 lane 起点 `16b1858f43a325acbe1b7da9afb750ea9569f8da`。执行：

```sh
cd /opt/projects/jamie/hermes-app
sh probes/p0/plugin-history/run.sh
```

实测 **19/19** 检查通过（退出码 0）；逐项实际观测见 [evidence.json](../../probes/p0/plugin-history/evidence.json)。`run.sh` 用 `env -i` 清凭据、`uv run --no-project --python` 指向基线已有 `.venv`，设置独立 `HOME`/`HERMES_HOME`/四条明确 DB 路径；`probe.py` 在允许的 scratch 创建临时目录，结束后删除（JSON 中 `temporary_directory_removed=true`）。未开网络监听、未用真实聊天/凭据、未调用模型、未安装到活动 profile、未改 Hermes 核心。SQLite 3.50.4 的 WAL-reset 防护警告出现；实际退为 DELETE journal，不能据此证明生产 WAL 并发安全。

## 插件访问层级与关键结论

- **实际加载的正式扩展入口**：`plugin_api.py` 作为临时 *user* dashboard plugin，`dashboard/manifest.json` 指明 `api`，临时 `config.yaml` 的 `plugins.enabled` 允许它，真实 `hermes_cli.web_server` 导入时挂载 `/api/plugins/p0-history-probe/`；通过真实 app 的 FastAPI `TestClient` 请求，而非在测试里手动 `include_router`。错误 token → 401；运行时禁用 → 404。此为 dashboard HTTP 插件 API，**不是** gateway platform adapter，也不是 `groups.*` RPC 的插件注册。用户插件代码可直接 import Hermes 模块是文档明示的能力，但具体 `gateway.hosted_rooms` / `hosted_room_driver` 函数是内部模块，不能由此推断它们有稳定、受支持的外部插件契约，更不能把 `groups.*` 的鉴权/hosted service 语义转移到原始存储函数上。文档：基线 `website/docs/developer-guide/desktop-plugin-sdk.md:794-834`；挂载门禁 `hermes_cli/web_server_dashboard.py:782-874`、动态禁用 `hermes_cli/web_server.py:595-634`。
- **现有公开 room RPC 不等于探针路由**：`tui_gateway/contracts/groups_bot_relay.py:228-277` 的 `groups.send` 是 *inert* user event，`groups.log` 是限量 delta；`tui_gateway/methods_groups.py:381-393` 从 hosted service 发消息并声明接受，探针的 `/send` 仅直接写临时 Room DB、没有经过这个 service、没有执行/多端广播，不得标为 hosted API 端到端通过。
- **两套内容不能成为双权威**：SessionDB 原文是模型/会话历史的现有权威；Room 的 `message.user` 带文本仅用于验证 durable receipt/idempotency 原语，不证明它可同时作为 App 的第二套权威 transcript。P1 必须明确单一正文权威及 room event 与 SessionDB 的写入/去重/重建关系；本探针没有复制 SessionDB 聊天正文到插件元数据 DB，后者只有 `(room,user,cursor)`。

## H01–H06 状态（小探针，不是正式 App backend）

| 项 | 状态与实测 | 未满足的产品边界 |
|---|---|---|
| H01 Channel / Thread 映射 | **实测已有 Project 能力 + 实测插件路由**：通过挂载路由调用 `projects_db.create_project/update_project/archive_project/list_projects`，改名/说明持久、归档从普通列表消失，均在隔离 `projects.db`。源码 `hermes_cli/projects_db.py:220-295,362-367`；SessionDB 有 `create_session`/`set_session_archived`，Room 有 `create_room/list_rooms/rename_room`（`gateway/hosted_rooms.py:857-939`）。 | **映射缺失**：Project↔多个稳定 Thread↔压缩 lineage↔room 的引用、Thread 独立 CRUD/排序/归档及一致权限未定义/未验证。Room 不是 Project；Description 自动注入亦未证明（见 `docs/p0/history.md`）。 |
| H02 连续历史 | **实测插件路由展示路径**：`SessionDB.resolve_resume_session_id/get_resume_conversations` + 真实 TUI `_history_to_messages`，合成 root→child 的普通正文 3 条，无摘要/hidden/branch。源码 `hermes_state_messages.py:1213-1238`、`tui_gateway/session_history.py:195-247`。 | **缺口**：本路由会先物化整条 lineage，既无真正有界跨段分页也无稳定业务 ID；返回 `row_id` 仅物理 ID，压缩携尾可变（前次实测 `docs/p0/history.md:18-29`）。核心 REST `/api/sessions/{id}/messages` 仍只分页 tip，不能当此需求已实现。未测实时流式与冷历史归并。 |
| H03 durable 同步 | **实测插件路由→内部 Room 存储**：序号 `[1,2]` 两页；取 snapshot 游标 `2` 后追加事件，delta 只得 `[3]`；未来游标返回 400；另一新 Python 进程重新走插件真实挂载读出 3 事件与持久已读位置 2。源码 `gateway/hosted_rooms.py:1140-1189`。 | **局部路线非完整同步**：无客户端双端、长离线过期日志 gap、删除/归档后的 resnapshot 协议、在线推送或订阅背压验证。`MAX_EVENTS_PER_ROOM=50_000`、`MAX_ROOM_EVENT_BYTES=256 MiB`、`MAX_GATEWAY_EVENT_BYTES=16 MiB`（`gateway/hosted_rooms.py:33-45`）；不能承诺无限原文。 |
| H04 receipt / 原子 admission | **实测内部存储经插件可触达**：同 send ID/同文重试只 1 event；改文 409；新 send ID/同文有新 seq；driver 原语相同 TaskIdentity 重试 1 queued task（`gateway/hosted_room_driver.py:582-604`）。 | **负例已复现**：event 已提交时 driver tasks 为 0；两次独立事务之间崩溃/失败窗口仍在。`groups.send` 的 inert receipt 不保证只一次执行，更不保证外部工具 exactly-once。需要设计有权威接收+入队的原子边界、恢复/补偿、fenced execution；不是本轮补丁。 |
| H05 read / unread / search | **实测插件自有最小元数据**：SQLite `MAX(old,new)`，2→1 不倒退；新进程可读 2。**实测现有内部搜索原语** `SessionDB.search_messages` 查出合成原文（`hermes_state_search.py:1038-1072`）。 | 未实现生产 unread、跨设备 user identity/ACL、按 Thread 可见历史的搜索/定位；现有 search 是跨会话索引而非有权限的 App Thread 搜索。展示 latest_seq−cursor 不能直接等价未读消息数（有控制事件）。示例路由同一 dashboard 管理 token 可读取任意传入 user 的 cursor，仅证明缺口，不能对外暴露。 |
| H06 隔离 / 保留 / 删除 | **负例实测**：SessionDB 删除 `root-A` 后，同键 `root-A` 的插件已读元数据仍为 2；插件 disable 阻止请求却不自动删除元数据。源码 `hermes_state_sessions.py:1517-1557`；Room 容量上限和 tombstone 保留 `gateway/hosted_rooms.py:33-45`。 | 无生产用户/profile 授权或删除级联、保留/导出治理；示例是单管理 token、明确 DB 路径，不能说明多个 profile 安全。插件读游标/映射生命周期需协调 core SessionDB 删除和 room disband；缺少已验证的事务/删除通知扩展路径。不要把重复消息数据库当方案。 |

状态判词：H01 的 Project CRUD、H02 的展示投影、H03 的持久 Room 日志、H04 的两类局部幂等、H05 的搜索基础都是**现有原语**；本探针验证的是其中若干原语可从**实际 dashboard 插件加载的 HTTP 路由**调用，H05 已读只为**插件自有微型状态**。H02 有界稳定分页、H04 原子接收执行、H05 完整未读搜索、H06 完整权限生命周期均**未实现/缺可靠插件边界证明**。正式支持的 Python 入口是 APIRouter 加载，不等于每个 import 的内部函数都有兼容承诺；如必须将这些操作合成原子操作，应优先比较现有 hosted service/公开 RPC，不能修改核心/monkey patch 硬凑。

## 复验与边界

```sh
sh probes/p0/plugin-history/run.sh
# 输出：PASS 19/19 plugin-history checks; evidence=.../evidence.json
# 基线与 lane 洁净性检查：
git -C /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline status --short
git status --short
```

无真实 HTTP listener（TestClient 同进程），另起子进程只验证 plugin import + DB 冷重开；未走 hosted service 驱动 Agent、真实群组 RPC、支付模型、手机/桌面客户端或公网网络。未来游标 400 ≠ 事件被裁剪后的缺口恢复验证；SQLite fallback 不等于生产并发认证。示例 `plugin_api.py` 是**一次性证据代码**：硬要求四个 `P0_*_DB` 临时路径，不能部署或复制为 P1 正式后端。异常情况不会自动清理业务 profile（从未使用）。
