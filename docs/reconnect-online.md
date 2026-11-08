# 重连立即在线（reconnect-online）

## 问题

Jamie 报告：每次重连，手机都长时间显示 “Restoring connection…”。

原因：WebSocket 收到 `hello` 后，客户端进入 `syncing`。它要读完整个目录（`GET /v1/catalogue`）才进入 `online`。目录每页最多 30 行，下一页要用上一页的 `next_after`，所以各页只能顺序读取。

测量结果（2026-11-07，服务端代码 0.2.52，数据库只读副本）：

| 连接 | Channel | Thread | 页数 | 服务端计算全部页面 |
|---|---|---|---|---|
| jamie | 19 | 786 | 27 | 0.20 s |
| hermes-app-dev | 9 | 389 | 14 | 0.04 s |

从本机经 `agent.tuly.space` 发一次请求要 85–120 ms，直接访问本机端口要 2 ms。所以耗时主要来自请求次数，不来自服务端计算。在美国移动网络上，每次请求预计 150–400 ms（推断，未在 iPhone 上测量），所以 jamie 连接一次重连预计要 4–11 s。

在此期间，状态不是 `online`，所以以下功能都要等待：发送队列、receipt 补齐、输入中指示、todo 标记、搜索、文件页和模型设置。

## 行为

1. 客户端收到 `hello` 就进入 `online`。目录在后台读取，读完后一次替换。重连时，已有目录继续显示，`isCatalogueReady` 保持 true。
2. “Thread 或 Channel 不可用”的判断只依据 `isCatalogueReady`，不依据 `online`。第一次连接时，目录读完之前，手机端显示 “Opening conversation…”、“Opening channel…” 和 “Loading projects…”，不显示 “unavailable”。
3. 后台目录读取失败时，客户端结束这条连接并按退避重连，与以前相同。
4. 插件 0.2.53 发布 capability `catalogue_page_limit: 500`，`/v1/catalogue` 接受 `limit` 1..500。客户端使用服务端发布的值，最大 500。服务端没有发布这个值时，客户端使用 30。jamie 连接的完整目录因此只需 2 次请求。
5. 不变的规则：完整分页成功后才能确认某行已缺失；不引入客户端事件游标、增量同步或本地历史库（见 [open-session-live.md](open-session-live.md)）。

`syncing` 状态和 “Restoring connection…” 文字仍保留在类型和界面中，当前客户端不再进入这个状态。

## 不做增量同步的原因

插件的 `sync_events` 有递增的 `seq`，但它不适合作为目录游标：

- 协议明确规定不向客户端暴露事件游标，帧只是变化提示。
- Channel 变化来自核心 `projects_db`，`last_message_at` 来自核心 `state.db`，这些变化不完整地记录在 `sync_events` 里。增量读取会漏掉变化。

后台完整读取不再阻塞任何功能，而且只需很少的请求，所以不需要增量同步。

## 改动

- 共享客户端 `packages/client/src/liveClient.ts`：`hello` 后直接 `online`；目录读取使用 `cataloguePageLimit`。`index.ts`：读取并共享 `catalogue_page_limit`。
- 手机 `apps/mobile/src/App.tsx`、`projectRows.ts`：“不可用”提示以 `isCatalogueReady` 为条件。
- 桌面端使用同一共享客户端，可用性判断已经以 `isCatalogueReady` 为条件，不需要另改代码。
- 插件 `storage.py`：`CATALOGUE_PAGE_MAX = 500`；`adapter.py`：capability `catalogue_page_limit`。插件测试夹具改为给 adapter 绑定测试令牌（插件从 profile `.env` 读取令牌，不读进程环境变量）。

## 验证

- 共享客户端：新增 `packages/client/tests/reconnect-online.test.mjs` 4 项（`hello` 时在线且目录未就绪；重连时保留旧目录并在目录读完前打开会话；页面大小选择与回退；后台读取失败时重连）。用旧代码运行时前 3 项失败。`client:check` 109/109 通过。
- 手机：TypeScript 通过；测试 248 通过、0 失败、1 跳过（新增在线但目录未就绪时显示 “Loading projects…”）。
- 桌面：`desktop:check` 266 项，207 通过、0 失败、59 跳过。
- 插件：相关测试 10 通过、2 跳过。完整 P1：分支 20 项失败，`main` 32 项失败；分支没有新增失败，夹具修复修好了 12 项已有失败。
