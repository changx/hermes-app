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

## 发布记录（2026-11-07）

- 插件：仓库 `main` `41eeb97`，0.2.53 打包（`hermes-app-plugin-0.2.53-d185ab12….tar.gz`，sha256 校验通过）。解压到 `plugin-releases/hermes-app/releases/0.2.53`，文件与源码一致；`current` 0.2.52 → 0.2.53（六个 profile 共用）。Gateway 未重启（PID 1342135，启动于 2026-11-03 23:32:09 PST），待 Jamie 重启。重启前，运行中的插件仍是 0.2.52；新客户端读不到 `catalogue_page_limit`，所以每页仍读 30 行，但收到 `hello` 即在线。
- App：`main` `834abc7`（修复）和 `4125de7`（桌面版本）。
- Expo Go：只重启 `hermes-app-expo.service`（PID 1210948 → 534840）。公网 iOS/Android manifest 200，SDK 58.0.0，launchAsset 200（iOS 12855049 字节，Android 12946103 字节），两个 bundle 都含 `cataloguePageLimit`。
- TestFlight：iOS 更新 `61b433a3-8ae2-445e-a6f8-a7557dc6ec5c`，runtime `b32a4b59…`（与 build 2 相同），提交 `4125de7`。公网 manifest 返回该 ID；bundle 200，13750156 字节，SHA-256 与记录一致。下次冷启动下载，再下一次冷启动生效。
- 桌面 v0.1.121：run 42445960354 成功。app 和 DMG 均 Developer ID 签名，公证 `Accepted`，`source=Notarized Developer ID`；ASAR `dist/` 9 个文件的 SHA-256 与本地同一提交的构建一致；测试 266 项，0 失败。Release 已发布（`Hermes-0.1.121-macOS-arm64.dmg`）。
- 回滚：插件把 `current` 指回 `releases/0.2.52` 并重启 Gateway；App `git revert 834abc7` 后重启 Expo，并重新发布 TestFlight 更新；桌面重装 v0.1.120。
- Jamie 重启 `hermes-gateway.service`（PID 1342135 → 545498，20:30:39 PST）。未认证 capabilities 返回 401；认证 capabilities 在 hermes-app-dev（9790）和 jamie（9791）都返回 `catalogue_page_limit: 500`。本机完整读取目录：hermes-app-dev 1 页 365 项 0.02 s，jamie 2 页 804 项 0.04 s。
- 待验收：iPhone 和 Mac 真机上的重连时间。

## 修复：超过 100 行的目录连不上（2026-11-07）

Jamie 报告：Gateway 重启（20:30）后，手机连不上 jamie 和 hermes-app-dev 两个连接，其他连接正常。

原因：客户端按 `catalogue_page_limit` 请求 500 行一页，但 `parseCatalogue` 仍只接受最多 100 行，多于 100 行时抛出 `LiveProtocolError`。第一次连接时目录读取遇到协议错误，连接进入 `suspended`，所以一直连不上。只有目录多于 100 行的连接受影响：

| 连接 | 目录行数 | 旧解析，limit=500 | 新解析，limit=500 | 新解析，limit=30 |
|---|---|---|---|---|
| jamie | 801 | 失败 | 2 页 801 行 | 27 页 801 行 |
| hermes-app-dev | 365 | 失败 | 1 页 365 行 | 13 页 365 行 |
| sites-dev | 15 | 1 页 | 1 页 | 1 页 |
| emma | 6 | 1 页 | 1 页 | 1 页 |

（用公网地址读真实目录，并用两份 `liveProtocol.ts` 解析；只读请求。）服务端、Traefik、bridge 和配对设备都正常。

修复：`parseCatalogue(value, limit)` 接受的行数上限改为客户端请求的 `limit`（最大 `CATALOGUE_PAGE_MAX = 500`）。服务端返回的行数多于请求时仍然拒绝。目录读取把本页请求的 `limit` 传给解析。原测试夹具不分页，只有 2 个 Thread，所以没有发现这个问题；现在夹具按插件规则分页，并新增 2 项测试：800 多行的目录在 500、200 和 30 行每页时都能读完且连接不断开；服务端忽略 `limit` 时仍拒绝。旧代码运行时这 2 项都失败。

验证：`client:check` 111/111；手机 TypeScript 通过，测试 249/249；iOS 和 Android 导出成功，两个 bundle 都含新判断；桌面 `desktop:check` 266 项 264 通过，2 项失败（`browser-window-native` 110 s 超时、`native-electron` native tabs，均为已知不稳定项），单独重跑都通过。本次改动不涉及桌面代码。

### 发布记录（2026-11-07）

- App：`main` `4ebfb9c`（修复）、`09ab778`（文档）、`65ff305`（桌面版本），tag `v0.1.122`。回滚分支 `rollback/catalogue-page-items-before-release`（`f0a8e6b`）。
- Expo Go：只重启 `hermes-app-expo.service`（PID 534840 → 576909）。公网 iOS/Android manifest 200，SDK 58.0.0，launchAsset 200（iOS 12855506 字节，Android 12946560 字节）；两个 bundle 中 `CATALOGUE_PAGE_MAX` 0 → 5，`body.items.length > 100` 2 → 1（只剩 `parseCatalogueThreads`）。Gateway PID 545498 未变，插件未变。
- TestFlight：iOS 更新 `bb9bbdf1-17ff-46ec-b7ef-2aaccc3da9ef`，runtime `b32a4b59…`（build 2），提交 `65ff305`。公网 manifest 返回该 ID；bundle 200，13750293 字节。
- 桌面 v0.1.122：tag run 42448638516 在 DMG 内 stapler 检查时连接 Apple CloudKit 网络中断（`NSURLErrorDomain -1005`，Error 68），签名和公证已 `Accepted`；同一 tag 重跑 run 42449109993 成功。app 和 DMG 均 Developer ID 签名，公证 `Accepted`，`source=Notarized Developer ID`；ASAR `dist/` 9 个文件 SHA-256 与本地同一提交构建一致；DMG `sha256sum -c` 通过。Release 已发布（`Hermes-0.1.122-macOS-arm64.dmg`）。
- 回滚：App `git revert 4ebfb9c` 后重启 Expo，并按 `--to 61b433a3-8ae2-445e-a6f8-a7557dc6ec5c` 回滚 TestFlight 更新；桌面重装 v0.1.121。
- 待验收：iPhone（Expo Go 重新加载；TestFlight 冷启动两次）和 Mac（安装 v0.1.122）上连接 jamie 和 hermes-app-dev。
