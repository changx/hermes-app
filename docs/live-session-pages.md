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
- 当前分支 `feat/live-session-pages`；候选工作目录 `/opt/projects/jamie/_worktrees/hermes-app/live-session-pages`。真实插件多连接联调和物理设备验收尚未在本次执行。

已核对的导航参考：https://docs.expo.dev/router/basics/navigation/ 。实际栈复用另用锁定版本的 StackRouter 执行回归，避免仅凭文档推断返回行为。
