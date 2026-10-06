# 存活 session 页面

## 已确认规则

移动端和桌面端按连接身份＋稳定 Thread ID 保持一个页面实例。不同 session 页面可以同时存活，并同时订阅更新。

- A 打开 B 后，A 的消息、已加载历史、阅读位置、跟随状态、草稿、附件和阅读器仍属于 A 页面。
- 失焦、被覆盖、推入另一页面不释放 A，也不停止 A 的内容订阅。可见性只控制键盘、滚动、媒体播放及可见结果确认。
- 从 B 打开已存在的 A，复用原 A，不创建第二个 A。手机返回时移除 A 上面的页面。桌面仅激活原 tab，B 继续存活；关闭 tab 才释放对应内容和订阅。
- 页面真正销毁、连接身份移除或服务端确认目标失效，才清理对应 session 资源。关闭客户端不停止服务端已接受的任务。
- 切后台保留所有存活页面，只暂停连接和读取。恢复时核对每个页面的已加载窗口，不重建页面，不重置到最新。
- 新建页面默认打开最新；返回已有页面保留现场。冷启动不恢复聊天历史，不新增 SQLite 或磁盘历史库。

## 实现

`packages/client/src/livePages.ts` 的 `LivePageClient` 管理账户连接和目录。各页面的 `LiveSessionClient` 保留自己的 watch、游标、取消范围和消息对象，共享账户的目录 Map 和连接。聚合映射只引用页面所有的数据，供 outbox 和桌面 IPC 使用。

本次 `perf/account-network` 候选每个账户只建立一条 WebSocket。新页面发送 `watch` 的 `mode:add`，移除页面发送 `mode:remove`；未打开的 session 不读正文。插件 hello 必须包含 `multi_session_live:true`。旧 watch 命令仍保留单话题替换语义，旧客户端可以连接新插件；新客户端需要配套插件，不增加旧服务器回退路径。该候选已合入并随插件 v0.2.3 及以后版本在开发 Gateway 中运行。

移动端由 Native Stack 管理页面销毁。`sessionNavigation.tsx` 对已有页面使用 `dismissTo`，对新页面使用 `navigate`。内联链接、全文阅读器、频道列表和文件来源入口共用此规则。连接身份变化由原有 Stack key 清理页面。

桌面候选使用主进程 `openPages` 和 `DesktopTabManager`，每个 tab 使用独立 `WebContentsView` 与固定目标的 IPC。切页不销毁其他页，也不向主窗口广播全部正文。New chat 是完整正文/附件/Project 页面，成功后在原 tab 转为 Session 页。详见 [桌面标签工作区](desktop-tabs.md)。

## 验收与边界

共享客户端测试覆盖并发 A/B 更新、后台停止读取、恢复原窗口、旧响应隔离、旧 owner 不能清理新页面，以及发送确认归属。独立桌面 tab 回归覆盖切回 A 保留历史、DOM 与读点，后台 B 继续存活，关闭 B 后释放其 View。

自动测试中的网络和视图替身不是实际设备证据。iPhone 原生返回、阅读位置、键盘和媒体，以及 macOS 原生窗口体验仍需设备验收。隔离候选代码不等于已部署；发布入口、安装包、插件安装和服务重启不在本次修改授权内。

## 本地验证结果

- 共享 package：99/99；兼容客户端 unit：24/24；reliability：20/20。
- 移动端：504/504；桌面端：120/120。启用 Chromium 检查，以上测试均无失败或跳过。
- 三个 TypeScript 项目均零诊断；桌面构建成功；iOS 和 Android 离线导出成功。
- 移动 React 回归验证 A/B 同时挂载后返回原 A，保留场景对象及模拟阅读位置，不重新 open A。
- 桌面 Chromium 验证实际 DOM 实例和滚动位置在 A → B → A 后不变，B 从 DOM 移除。
- 真实隔离插件 HTTP/WS 多连接联调：1/1 通过，2 条非失败 aiohttp 警告。生产 SDK 和桌面传输同时读取 A/B 的真实 Store 提交，再释放 B 并恢复 A 的原窗口。数据为合成测试输入，不涉及用户实例或模型执行。
- 当前分支 `feat/live-session-pages`；候选工作目录 `/opt/projects/jamie/_worktrees/hermes-app/live-session-pages`。物理设备验收仍未执行。

已核对的导航参考：https://docs.expo.dev/router/basics/navigation/ 。实际栈复用另用锁定版本的 StackRouter 执行回归，避免仅凭文档推断返回行为。

## 内存与释放修复

以下是后续修复；上面的测试与分支记录属于首次多页面实现，不替代本次验证。

### iPhone 页面所有权

旧实现用 `useMemo` 在渲染阶段注册 session，但只在 effect 中清理。React 放弃尚未挂载的渲染时，注册表会留下无页面负责清理的实例。StrictMode 重放 cleanup 后，旧 memo 还可能引用已经注销的实例。

现在 owner 只在已提交的普通 effect 中获取。子页面只使用账号注册表中的 exact owner；cleanup 只释放该 owner。StrictMode 重放 setup 会重新获取 owner。权威目标删除后移除子页面并显示不可用提示，不重新打开脱离注册表的客户端。

不使用 layout effect 管理页面所有权。Suspense 临时隐藏已提交内容时可以清理 layout effect，但这种隐藏不等于页面销毁。测试覆盖这种覆盖仍保留原 owner、阅读位置和场景对象。

### iPhone 分配压力

未变化的消息数组和消息对象保持原身份。元数据更新不再序列化完整历史；轻量目录对象用 WeakSet 标记，不建立额外强引用缓存。移动时间线按正文数组、阅读窗口、收据、审批和发送记录变化复用投影。输入草稿不重建整段历史，真实收据更新仍刷新 reaction。

全文历史加载行为不变。存活页面持有完整历史时，占用增加属于预期。不通过丢弃隐藏页面、重置历史窗口或跳到最新降低内存。原生媒体和视图的占用仍需要 iPhone 真机测量。

### 桌面页面与窗口

显示已打开会话和逐页关闭入口。当前独立 tab 候选选择已有页面时只激活该页，不移除其他页面。显式关闭隐藏页只释放目标页；关闭当前页激活相邻存活页，保留原 DOM、阅读位置和已加载历史。窗口真正 `closed` 时释放全部 session 页面及原生 View，并清空最后发布的 snapshot。最小化、失焦和后台不执行此清理。

账号目录、发送队列和设备本地持久草稿不因页面或窗口关闭而删除。重新打开窗口获得新的 snapshot baseline，不使用已销毁窗口的增量基线。

`sessionPages` 不再作为标量 state 附带完整正文。IPC 对每页消息和审批增量更新，显式记录删除和顺序。状态更新不传输未变化的各页历史；初始化和真正新增页面仍发送必要 baseline。

### 修复验证与边界

- 生产 React 页面及真实 SDK 所有权验证：20 次放弃渲染无残留；StrictMode 重放后 owner 注册有效；Suspense 覆盖保留原场景；权威目标删除不重开 detached 客户端。网络打开为替身，连接与 GC 单独验证。
- SDK GC 探针：50 轮、100 个实例，WeakRef 残留为 0；101 条测试连接全部关闭。两页合成完整历史共 4,000 条消息，释放后堆内存回到基线附近。
- 真实隔离插件 HTTP/WS 联调通过 A/B 并发、B 释放和 A 原窗口重连。数据为合成输入，不涉及用户聊天或模型执行。
- Chromium 执行生产桌面 UI：关闭 B 按钮调用目标 IPC，A 原 DOM 和滚动位置保持不变。原生窗口行为另待 macOS 验收。
- 两页合成 4,000 条历史，单状态修改增量的 JSON 为 242 bytes，无顶层或嵌套正文传输。JSON 大小不等于 Electron structured-clone 实际 IPC 字节数。
- 完整测试、TypeScript、桌面构建、iOS/Android 导出和证据在 Channel `session-page-memory/RESULT.md` 中记录。

这是隔离分支 `fix/session-page-memory` 的本地验证，不是 iPhone/macOS 原生进程内存测量，也不代表已经合并或在手机生效。Hermes 核心和插件协议均未修改。

已核对 React 参考：[useEffect](https://react.dev/reference/react/useEffect)、[Suspense](https://react.dev/reference/react/Suspense)。

## 渲染资源复用候选

隔离分支 `perf/render-resource-reuse` 在上述页面所有权基础上增加以下机制。下面记录的是发布前的候选验证；后续发布结果见本节末尾。

- 手机每个已挂载 session 使用一个 `RenderResourceScope`。所有存活页面共享一个 LRU 预算：估算 16 MiB、最多 256 项。预算针对可驱逐的派生缓存，不是总 JS 堆或原生内存上限；存活组件直接持有的解析结果、阅读器、引擎静态资产和原生实例不在此预算内。
- 缓存按页面隔离，按稳定消息身份复用 AST 和渲染资格计划。正文变化重建；字号变化只重建相关 HTML，不重解析正文。节点和文章 HTML 共用该预算，超预算结果可显示但不加入缓存。
- 解析及 HTML 缓存允许行复挂载复用（时间线已改为普通 ScrollView，见 docs/m1-history-scrollview.md）。全文、表格和图表阅读器显式携带原页面的资源上下文，不依赖根导航上下文继承。实际关闭页面清理缓存；失焦不清理。未提交渲染不注册全局资源，StrictMode effect 重放不误释放。
- 首次折叠的过程不挂载正文与附件。首次展开后再折叠保留已挂载实例。手机回收行换消息时重置首次展开记录及正文实例，防止旧消息状态进入新消息。
- `suspended` 在重型 HTML 构建前返回。数学/图表和全文 WebView 使用稳定 `source` 对象，尺寸及状态更新不创建等值对象触发重载。
- 历史消息不创建发送颜色动画；曾经发送中的消息共用一个减少动态效果监听。迟到的系统查询不能覆盖更新后的事件。
- KaTeX/Mermaid 公共脚本的结束标签转义每个执行环境只执行一次。桌面 Mermaid 首次加载和初始化合并为一个 Promise，失败可重试；Markdown 的组件类型和插件数组固定。单篇手机文章内多个图表只初始化 Mermaid 一次。

独立 WebView 仍有独立引擎环境。此次未实现跨 WebView 公共资产加载、共享引擎实例、桌面可见窗口虚拟化或图片任务合并，不用缓存命中率代替这些验收。

本地候选验证：手机 544/544、桌面 147/147，启用 Chromium，零失败、零跳过；手机和桌面 TypeScript、桌面构建、iOS/Android 导出通过。测试执行生产组件与 HTML runtime，但以替身计数渲染引擎及原生组件，不是 iPhone/macOS 原生 CPU、内存或手感证据。完整日志见 Channel `render-resource-reuse/`。

### v0.1.21 发布

Jamie 已授权合并并发布。候选保留 main `44be4be` 的频道工具栏、筛选和运行中排序改动，整合后手机 546/546、桌面 147/147，启用 Chromium，零失败与跳过。TypeScript、双平台导出、桌面构建、依赖审计通过。

发布源 `cd8add8289dc8074dd5ae01118506ef8c784278f` 已合入并推送 main，标签 `v0.1.21` 指向该提交。主分支 CI `37180717553` 和标签发布 CI `37180718314` 均成功。[桌面发布](https://github.com/changx/hermes-app/releases/tag/v0.1.21)包含未签名、未公证的 macOS arm64 开发包。下载后 SHA-256 校验匹配 `75ea735a5e834d792eaa16252cbceda24c6c8d28977f2b7e25390c0104c916a0`；Mach-O 架构为 arm64；ASAR 包版本、稳定 Markdown 配置和延迟折叠挂载代码已核对。

现有手机测试入口 `exps://agent.tuly.space` 已更新，只重启 Expo。公网 iOS/Android manifest 与各自 exact launchAsset 均返回 200、runtime 57；正文缓存、公共脚本、共享监听及既有草稿/页面代码均在所服务 bundle 中。初次无 Expo User-Agent 的 Python 请求返回 403，改用 Expo/57 后读取成功。

发布前后开发与 Jamie Gateway PID/start 状态、插件文件哈希及手机 lockfile 均未变化。未操作签名账户、安装插件、重启 Gateway 或改写聊天数据。运行源码回滚基线 `0de8ffa` 保留于 `rollback/render-reuse-before-0.1.21`；正常回滚使用明确的 Git revert，不能重置聊天数据库。发布与资源验证不代替 iPhone/macOS 真机性能验收。
