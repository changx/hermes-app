# 存活 session 页面

## 已确认规则

移动端和桌面端按连接身份＋稳定 Thread ID 保持一个页面实例。不同 session 页面可以同时存活，并同时订阅更新。

- A 打开 B 后，A 的消息、已加载历史、阅读位置、跟随状态、草稿、附件和阅读器仍属于 A 页面。
- 失焦、被覆盖、推入另一页面不释放 A，也不停止 A 的内容订阅。可见性只控制键盘、滚动、媒体播放及可见结果确认。
- 从 B 打开已存在的 A，返回原 A，不创建第二个 A。返回时移除 A 上面的页面；移除的页面释放内容和订阅。
- 页面真正销毁、连接身份移除或服务端确认目标失效，才清理对应 session 资源。关闭客户端不停止服务端已接受的任务。
- 切后台保留所有存活页面，只暂停连接和读取。恢复时核对每个页面的已加载窗口，不重建页面，不重置到最新。
- 新建页面默认打开最新；返回已有页面保留现场。冷启动不恢复聊天历史，不新增 SQLite 或磁盘历史库。

## 实现

`packages/client/src/livePages.ts` 的 `LivePageClient` 管理目录连接和每个页面的 `LiveSessionClient`。每个页面有自己的 watch、游标、取消范围和消息对象。聚合映射只引用页面所有的数据，供 outbox 和桌面 IPC 使用。

当前插件每条 WebSocket 只接收一个 watch。客户端为各存活页面使用独立 WebSocket，复用已有协议，不修改 Hermes 核心或插件。连接和健康心跳数量随存活页面数增加；未打开的 session 不读正文。

移动端由 Native Stack 管理页面销毁。`sessionNavigation.tsx` 对已有页面使用 `dismissTo`，对新页面使用 `navigate`。内联链接、全文阅读器、频道列表和文件来源入口共用此规则。连接身份变化由原有 Stack key 清理页面。

桌面端主进程维护页面栈和各页面历史窗口，IPC 发布 `sessionPages`。renderer 保持栈内时间线及 composer 挂载，仅隐藏被覆盖的页面。选择已有 session 移除其上页面；选择频道关闭整个 session 栈。

## 验收与边界

共享客户端测试覆盖并发 A/B 更新、后台停止读取、恢复原窗口、旧响应隔离、旧 owner 不能清理新页面，以及发送确认归属。桌面回归测试覆盖返回 A 保留旧历史和移除 B。

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

显示已打开会话和逐页关闭入口。返回已有页面仍移除其上页面。显式关闭隐藏页只释放目标页；关闭当前页返回上一存活页，保留原 DOM、阅读位置和已加载历史。窗口真正 `closed` 时释放全部 session 页面，并清空最后发布的 snapshot。最小化、失焦和后台不执行此清理。

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
