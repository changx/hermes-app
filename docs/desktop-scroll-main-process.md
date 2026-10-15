# 桌面：长 Session 滚动卡顿（主进程发布成本）

## 现象

桌面端滚动长 Session 时，内容一段一段地跳动。报告的 Session 是 `th_d23536acac29464ab06dd7a6`（jamie 连接）：402 条消息，392 个工具调用，11 张截图。

## 测量

脚本和数据保存在私有 scratch 中，未提交。

1. **渲染进程不是原因。** 我们用真实消息和截图渲染 `DesktopShellView`，然后用滚轮滚动 120 步，每 250 ms 推送一次新快照。
   - Mac mini（M4，Chrome，GPU，有窗口）：帧间隔 p50 17 ms，p99 19 ms，无长任务。每次时间线重渲染 1–5 ms。
   - 宿主机无头 Chrome：p99 33 ms，无长任务。
2. **主进程是原因。** 每个服务端事件（任意 Session 的回执、消息、工具记录）都会同步执行以下操作：
   - 为每个标签页重新投影 Session；
   - 对每条消息执行 `JSON.stringify` 比较；
   - 多次只为读取 `phase` 或 `connectionKey` 而调用完整的 `service.snapshot()`。该调用会投影全部打开的页面。

   在 2 个连接、143 个 Session、每页 402 条消息的条件下，主进程单次事件成本如下：

   | 打开的长 Session 标签页 | 修改前 | 修改后 |
   | --- | --- | --- |
   | 1 | 12.5 ms，17 次投影 | 2.5 ms，6 次投影 |
   | 8 | 81 ms，192 次投影 | 8 ms，20 次投影 |

   macOS 的滚轮事件先经过 Electron 主进程（UI 线程），再到达页面。主进程忙时，滚动输入会延迟并成批到达，因此出现卡顿。见 [Electron Performance: Blocking the main process](https://www.electronjs.org/docs/latest/tutorial/performance#3-blocking-the-main-process)。

## 修改

- `DesktopConnectionService.status()` 返回连接状态（`phase`、`connectionKey`、`connectionState`、`connectionName`、提示），不投影 Session。`DesktopConnections` 的连接查找、`hasConnection`、连接列表和 Automation 归属都使用它。
- `snapshot(null, …)` 只投影目录和连接状态。`DesktopConnections.snapshot()` 汇总各连接的目录时使用它，所以不再为每个连接投影其当前 Session 的消息。
- 消息投影按客户端行对象缓存。只要行对象和回执对象都没有变化，就复用同一个桌面行对象。共享客户端不会原地修改这些对象（已更新的行或回执是新对象）。`snapshotDelta` 的 `equal` 先比较对象身份，所以未变化的行不再序列化。

回归测试：`apps/desktop/tests/main-publish-cost.test.mjs`。

## 验收

- 自动：桌面 `tsc`、`npm run build`、`npm test`（217 项：209 项通过，8 项 Electron 原生测试在宿主机跳过）。新测试在修改前的代码上失败。
- 真机：Jamie 的 Mac 上，打开报告的长 Session，在其他 Session 运行 Agent 时滚动，确认不再卡顿。此项待发布后验收。
