# 历史消息与执行状态同次读取

<!-- status-refresh-2026-10-06 -->
> **当前状态（2026-10-06 核实）：** 本文中的“后端待激活/待重启/Gateway 重启被拦截”已过时。开发 Gateway 已于 2026-10-05 20:43 PDT 重启，运行插件 v0.2.5（插件仓库 main `6abdaa4`），相关 capability 已在运行中返回 true。真实设备验收结论不受此更新影响。当前状态见 [开发环境](dev-environment.md)。

## 范围与关联

客户端与独立 `hermes-app-plugin` 仓库已合入并推送主分支。手机 bundle 已发布，插件文件已安装，但开发 Gateway 会话内重启被 guard 拦截，服务端新路径尚待外部激活；见 [开发发布记录](history-execution-state-release.md)。不改 Hermes Core、真实聊天数据或其他 profile。

- 复用 `message_refs.input_receipt_id → receipts.id` 的既有唯一外键，作为新消息的权威关联。
- 客户端同时校验 `thread_id + receipt_id + client_message_id + ref_seq`，不使用正文、邻近回复或最新任务猜测。
- 旧 core row 仅在 `user_row_id` 关联唯一、同 Thread 且输出消息身份相符时返回状态；重复/跨话题关联不补造状态。
- 不新增表，不复制消息正文或另存 reaction。reaction 仍由真实 processing 回调状态投影。

## 返回契约

`GET /v1/threads/{id}/messages` 的 forward、after_ref_seq、latest、before、exact ref 均增加同级 `receipts: Receipt[]`。

消息保留原字段和身份，通过 `messages[].receipt_id` 关联 `receipts[].id`。状态是同一次响应中的独立元数据，不嵌入原始消息正文；这样执行变化不改变历史消息记录本身。空页返回 `receipts: []`。

插件在读取页的同一 SQLite 事务中，按本页 refs **一次批量关联查询**执行状态，只返回实际输出消息对应的收据，不逐条调用 receipt 接口。底层原文仍从既有 Hermes 权威存储读取；这不是宣称全部历史读取只有一条 SQL。

Receipt 增加 `version`，复用已有持久 `event_version`；历史、发送 ACK、单收据读取及 snapshot 使用同一版本字段。客户端先校验整页收据，再不通知地写入既有缓存，最后统一发布消息页，避免初次渲染触发可见收据补读。较旧版本不能覆盖较新的实时状态或反馈。

实时事件、发送恢复及旧服务端有界收据补读仍保留。审批/澄清继续沿用现有 snapshot/interaction 同步，不在本次新增独立审批存储。

## 验证

- 插件 P1：264 passed，含新增 6 项关联、四种分页方向、持久冷读、歧义/跨话题保护、批量 SQL 与真实鉴权 HTTP 验证。
- 共享客户端：24 基础 + 20 可靠性 + 33 package tests 全通过，含新增 9 项历史状态和版本竞态测试。
- 手机：361 tests 全通过；共享客户端与手机 TypeScript 通过。
- iOS/Android Expo 导出通过。隔离 worktree 的依赖软链接最初被 Metro 拒绝，改用既有锁定依赖的独立副本后通过；没有重复安装或修改 lockfile。
- 实际本地 HTTP 联调：生产 plugin route + 生产 HermesClient，两次全新客户端读取，各一次 history 请求、零次 receipt 请求，恢复 completed/failed 且身份匹配。使用隔离合成数据库，不是上游模型或真机验收。

证据：`/home/hermes/.hermes/profiles/hermes-app-dev/workspace/history-receipt-snapshot/`。

首次本地验证时未部署、未重启 Gateway/Expo。后续授权发布进度见 [开发发布记录](history-execution-state-release.md)；iPhone 重开/翻页视觉与网络行为仍需另做真机验收。
