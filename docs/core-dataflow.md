# 核心数据流

## 当前唯一通信路径

桌面和手机都使用 `LivePageClient`。每个连接身份持有一个账号 WebSocket、轻量目录和运行状态。每个存活页面按连接身份与稳定 Thread ID 持有独立正文、收据、审批、历史窗口及媒体资源。

```text
桌面 / 手机
  → LivePageClient：账号目录、单一 /v1/live 连接
  → 存活页面：按 Thread 订阅、读取历史与 live-state
  → Hermes App plugin：认证、持久接收、投影、变更通知
  → Hermes：历史与执行权威
```

旧的 `/v1/events`、`/v1/sync`、`/v1/snapshot` 已在插件 `a43f311` 删除，开发 Gateway 当前对这些路径返回 404。没有旧客户端，不保留第二套事件回放传输。共享客户端不再提供 checkpoint、catchUp、resync 或通用消息已读位置 API。

插件内部持久事件仍供 `/v1/live` publisher 消费。不能把内部提交通知和事件记录当作废弃对外接口删除。历史分页游标、消息 `ref_seq`、本地请求代次也不是事件回放 checkpoint。

清理已合入两个仓库 main，并在开发 Gateway 中运行（插件 v0.2.5）。

## 目录与页面恢复

1. 建立认证连接并读取 capabilities。
2. 分页读取 `/v1/catalogue`，只保留轻量目录和运行状态。
3. 打开页面时发送该 Thread 的 watch 请求。
4. 等待匹配的 watching 确认。
5. 读取该页面的历史与 `/v1/threads/{id}/live-state`。
6. 收到变更提示后核对当前页面窗口或状态。

watch 确认先于初次正文读取。读取期间的提示触发再次核对，避免订阅交接丢失变更。提示不携带正文，也不要求客户端保存全局事件游标。

多页面使用同一个账号连接，并发保留各自订阅。打开 B 不释放 A。页面真正销毁、身份移除或服务端确认目标失效时，只释放对应页面。迟到响应不能恢复已释放内容。

切后台只暂停传输和请求，保留页面现场。回前台或重连时核对原窗口，不重建页面、不跳到最新。心跳只检查连接，不轮询目录或正文。系统杀进程后没有本地服务端历史副本。

完整生命周期见 [存活 session 页面](live-session-pages.md)与 [OPEN-SESSION-LIVE](open-session-live.md)。

### 目录变更（创建、改名、归档、删除、标签、已读）

客户端创建、改名、归档或删除 Channel／Thread，保存标签，或确认结果已读后，只等待这一个写请求。写请求的响应就是服务端已提交的行。共享 SDK 用响应更新账号目录，然后立即返回；不再追加 GET 回读，也不等待整个 `/v1/catalogue` 重新分页读取。归档的 Thread 立即离开目录，与 catalogue 一致。已读确认 `POST /v1/threads/{id}/result-read` 的响应带已提交的 `completed_unread`、`result_version`、`result_ref`，SDK 直接写入该行；该行已显示更新的结果时保留。

服务端提交后推送 `directory_changed`。只有 Thread 行变化时，推送带 `thread_ids`（最多 100 个）；支持 `catalogue_threads` capability 的客户端只读这些行：`GET /v1/catalogue/threads?id=<id>&id=<id>`，响应为 `{items, missing}`，行格式与 catalogue 相同。`missing` 中的 Thread 已不存在或不在可用 Channel 中，客户端删除该行。请求次数与 session 总数无关，固定 1 次。

以下情况客户端仍完整分页读取 catalogue：推送不带 `thread_ids`（Channel 变化、超过 100 个 Thread）；服务端不支持该 capability；首次目录读取未完成；行属于本地未知的 Channel；读取变化行失败。

同一 Thread 的变化行读取按发起顺序生效，较旧的响应不覆盖较新的响应。已读确认返回后，此前发起的该 Thread 行读取作废，不能恢复未读标记。某次分页读取开始后才确认的行，以确认的行为准，不被这次较旧的读取覆盖或删除；之后开始的读取以服务端为准。断线期间错过的推送由重连后的 hello 目录读取补齐。推送仍只是提示，不是事件日志，不携带游标或版本。

此前每个变更要等待一次完整目录读取；读取期间到达的 `directory_changed` 又触发第二次读取。开发连接有 194 个 session（7 页），创建一个 session 需要 15 个顺序请求，北京约 4 秒。现在为 1 个请求。已读确认此前为 1 个 POST 加完整目录读取（jamie 连接 65 个 session，3 页，共 4 个顺序请求；北京单次请求约 0.2–0.6 秒），现在为 1 个 POST；其他设备收到推送后读 1 次变化行。

发布记录（2026-10-12）：App `de795c9`，标签 `v0.1.71`（同时包含已合入 main 的 automation 编辑客户端 `6e155b4`、`95ba24f`）。Mac mini 构建 180 项测试 0 失败；下载的 `Hermes-0.1.71-macOS-arm64.zip` 校验和通过，Info.plist 版本 0.1.71，arm64，ASAR `dist/` 29 个文件与本地构建逐字节一致。Expo 测试入口已重启（PID 1398110），公网 iOS/Android manifest 200、SDK 57，launchAsset 200，均含新代码标记；Gateway PID 与插件哈希不变，未改插件或核心。真机（iPhone、Mac）验收未做。

## 发送与接收证明

设备本地持久保存未确认原文及 `client_message_id`。同一次发送重试必须使用相同 ID、Thread、原文和附件；相同正文的两次独立发送使用不同 ID。

插件在事务提交收据、待派发输入及相关内部通知后返回持久 ACK。匹配的认证 ACK 证明输入已接收，不证明执行完成。ACK 响应丢失时只用相同 ID 重试，不生成另一次执行。客户端不自动重试模型或工具的 `unknown` 执行。

持久 ACK 后可移除设备 outbox 原文，并按稳定接收引用显示输入。后续执行状态由页面 live-state、历史与正式处理回调提供。客户端关闭不取消服务器已接收任务。

### 新 session 的第一条消息

条件：只有文字，没有附件，使用默认模型。满足条件时，客户端不先等待创建请求：

1. 客户端生成 Thread ID 和消息 ID，把消息和创建请求（Channel、标题、automation 标记）一起写入设备 outbox。
2. 页面立即打开，从 outbox 记录显示标题和这条消息。
3. outbox 先用这个 Thread ID 创建 session，再发送消息。重试使用相同的 Thread ID 和消息 ID，服务端返回已有 session，不重复创建。
4. 同一 session 中后来的消息排在第一条之后。临时失败按发送退避重试；服务端拒绝创建时，消息保留在设备上，显示“无法开始这个对话”，可重试或删除。

有附件或选择了其他模型时，仍先创建 session（附件需要 session，模型可能需要用户确认），再写入 outbox。

服务端确认创建后，页面从“开始中”视图切换到正常会话视图，时间线保持连续：

- 两个视图中的 `ChatTimeline` 使用同一个 key，切换时不重新挂载。重新挂载会隐藏时间线，直到重新定位（最多 600 ms），用户会看到消息消失再出现。
- 第一条消息的持久 ACK 可能早于 watch 确认。只要页面正在打开或已打开这个 Thread，SDK 就按 ACK 的 `ref_seq` 插入这条输入；outbox 随后删除本地原文，消息不会消失。历史读取按 `ref_seq` 合并，服务端行覆盖这条回显。
- 页面只在打开请求结束且没有显示内容时，才显示“Could not load this conversation”。打开尚未开始（首次渲染、刚确认的新 session）或被失焦、切后台中断时，显示加载状态。

刚由本客户端创建的 Thread 第一次打开时，`openConversation` 立即报告正文就绪，不等待 watch 确认和历史读取；这两步仍在后台执行并核对。桌面主进程把 HTTP 空闲连接保持 60 秒（undici 默认 4 秒）。没有这个设置时，用户停下来输入后，下一个请求需要重新进行 TLS 握手（北京到 `hermes-jamie.tuly.space` 约 0.5–1.2 秒，复用连接约 0.2 秒）。

## 历史与消息身份

服务器拥有原始历史。客户端只保存存活页面的展示窗口，不建立 SQLite 历史库。最新、较早、精确引用和增量读取继续使用现有历史 HTTP API。

消息按稳定 `id`、`ref_seq` 及精确 receipt/client ID 关联。正文和时间戳不参与身份判定。压缩后的复制行不重复发布原始输入或结果；摘要不能替代缺失原文。

页面保留当前窗口、滚动锚点和媒体现场。普通分页游标只定位历史页，不承诺账号事件回放。

## 执行、审批和附件

processing 仅由正式处理开始/结束回调驱动。接收、入队或交付不等于完成。重启后缺少可靠完成证据的执行保持 unknown。

审批和澄清绑定精确 Thread、receipt、请求 ID 与代际。竞争答复只有一个获胜；过期或已答请求从 scoped 状态收起。停止使用现有服务器执行控制，不把网络取消当作工具停止。

附件继续由插件保存受控元数据与文件，精确验证 Thread、路径、大小和引用。上传、下载、删除未附上传与冷恢复不依赖旧事件回放。

目录的完成未读标志是现行窄范围能力，见 [已完成未读目录状态](completed-unread-directory.md)。它不是已删除的通用消息已读位置或未读计数链。

## 验证边界

精简时的基线为 1,066 个单元测试，保留 107 个（10.04%）：共享客户端 10、桌面 14、手机 55、插件 28。删除测试定义或文件，不通过 skip 隐藏数量。保留的单元测试全部通过；103 个原有集成测试保留，本次不重跑插件全量集成测试。上述数量属于精简时的快照；合并时同时保留主分支后续新增的历史读取、独立标签页和网络提示改动及检查，不据旧数量声称当前总数。测试通过不代表服务已经部署。

`npm run client:check` 验证共享 SDK 和故障测试。桌面与手机分别运行现行测试、类型检查和构建。插件在独立仓库 `/opt/projects/jamie/hermes-app-plugin` 运行隔离的 `tests/p1` HTTP/WS 与真实 Gateway 测试。

重复的 `tests/client/unit.test.mjs`、`reliability.test.mjs` 和大型 `real-gateway.mjs` 已删除。共享 SDK 保留 `packages/client/tests` 中的功能检查；现有插件 HTTP/WS 联调入口不变。不再为纯客户端检查要求 Hermes 基线目录。

自动检查不是远端模型、Mac、iPhone 或独立安装包验收。不得以测试通过宣称服务已部署。
