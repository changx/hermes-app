# 历史加载触发链调查（不是修复或发布）

## 用户约束

Jamie 要求查实际重复发起的 bug，拒绝用“一次手势最多一次”计数锁掩盖原因。之前人工连续调用 onRefresh 仅说明入口允许重复调用，并未证明 UIKit 真实重复发出事件。

## 已复现的真实代码路径

基线 `3de1a7f` / 已发布功能 `de6d209`。生产 AppProvider + ThreadScreen 在真实 React 调度下，采用受控合成 SDK 响应和状态：

1. 只发起一次 onOlder 意图，older 请求处于待返回状态。
2. SDK 最新消息补齐标记 `tailIncomplete` 变为 true，并发出 revision。
3. App.tsx 的恢复 effect（约 405–411 行）不区分当前正在读取旧历史，直接调用 openThread。
4. openThread 递增 openingRef，清 pageCursor，setLocated(false)，重置 startRef 并另发 latest 历史请求。
5. visibleMessages 由 located 控制（约 389–391 行），因此在最新请求返回前成为空数组。原 older 请求因 openingRef 变化而失效，不能提交其 3 段窗口。
6. 最新请求返回后恢复到最新 3 段，而不是完成用户刚要求的 older 扩展。

实际执行 trace：`one-user-load-intent → older request → latest request → older response → latest response → resume-tail`。没有第二次 onOlder 意图，也没有模拟第二次原生 refresh 事件。观察到了原可见 rows 清空以及 older 展开被取消。

这是一条可确定的竞争路径，但不表示 Jamie 每一次 iPhone 症状都是由这个条件触发。仍缺其发生时的实际客户端事件 trace。

## 对照与条件来源

- 同样只发起一次 onOlder，普通 SDK revision 不设置 tailIncomplete：只沿旧 cursor 顺序补页；没有第二个 latest loader，3 段正常展开。
- 使用真实 HermesClient.historyTail 和合成 HTTP 页面确认：最新补齐超过其既有 3 页预算时，确实设置 tailIncomplete 并发出 changed。该标记不是为证明结论捏造的新状态。
- 运行插件配置 `AppRunner(..., access_log=None)`；Expo journal 只有 Metro/服务日志，没有手机刷新事件或逐 API 请求 trace。不能宣称已从服务器日志定位实际 iPhone 第二次事件。

## 已核对的刷新转发链

- ChatTimeline 只提供 custom RefreshControl，没有同时设置 FlashList.onRefresh/onStartReached。
- 已安装 FlashList.useSecondaryProps 优先返回 customRefreshControl，只有不存在 custom 且提供 onRefresh 时才创建默认控件；不是两个刷新控件同时加载。
- KeyboardChatScrollView → ScrollViewWithBottomPadding 仅把 refreshControl/rest 传给内部 ScrollView，外层 clipping wrapper 不带 refreshControl。
- renderScrollComponent 使用稳定 useCallback；FlashList 内部包装组件按这个函数 identity memoize。单纯新建 JSX element 不等同于 native 控件重建。
- RN Fabric 的 onRefresh 发射点是 UIControlEventValueChanged；程序设置 refreshing/布局时走 beginRefreshingProgrammatically，该代码没有主动 sendActions/onRefresh。不能仅凭状态刷新断言 UIKit 发出了重复事件。

## 执行证据

调查测试文件：`apps/mobile/tests/history-trigger-investigation.test.mjs`，在隔离分支 `jamie/session-history-trigger-investigation`。3 项针对性调查通过，测试断言的是缺陷路径存在，不是宣称已修复。合成 SDK/HTTP 与 native substitute 均明确标识，没有读取真实聊天或凭据。

日志：`/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/session-history-trigger-investigation/investigation.log`。

## 修正方向（尚未实施）

最新数据恢复不能复用“首次打开对话”来重置正在阅读的页面；应区分初始化、旧历史分页和 tail 恢复的数据目的与生命周期，保留当前可见窗口，不让恢复流程无条件作废正在进行的旧历史操作。不是限制每个手势次数，也不是停掉正常多页补齐或网络恢复。

本轮未改运行源码、未合并 main、未部署、未重启服务，也未加次数锁。物理设备是否另有 native 重复刷新事件仍未验证。
