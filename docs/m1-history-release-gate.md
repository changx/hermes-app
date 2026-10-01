# 下拉历史等待松手（无额外延迟）

## 用户确认

Jamie 反馈手指还在下拉时就开始加载，这不符合要求。新规则：刷新阈值事件可以先到，但旧历史的缓存展开和网络分页都必须等到实际 `onScrollEndDrag`。之前取消的一秒延迟不恢复，不引入“每个手势一次”的次数限制。

## 修正

- RefreshControl.onRefresh 先记录待加载意图并维持受控刷新状态；未观察到松手时，Promise 等待 drag-end，不执行 onOlder。
- onScrollEndDrag 标记已松手并解开当前等待；若刷新事件本来在松手后到达，则直接开始，不使用定时器。
- 加载前重新检查当前聚焦、前后台、hasOlder/locatingBusy 与最新 onOlder 回调。缓存与网络走同一入口，因此都不在手指仍拖动时展开。
- 失焦、后台、卸载、主动 latest/send 或被新拖动替换时，取消尚未开始的意图；已开始的请求仍沿用 App 的原分页/生命周期保护。
- 以请求对象身份区分被取消的等待和后续新请求，旧 finally 不清掉新请求的进度或所有权。这里没有计数或消耗“每手势一次”的许可；正常后续下拉仍可加载。
- 后台/隐藏页面的旧 drag-end 不启动数据加载。仍使用原 FlashList、220ms opacity 淡入、3 段分页和独立 tail 恢复；不改 SDK、App 数据流、依赖、服务端或核心。

## 验证

- 发布前生产组件在新验收测试中失败：手指仍在拖动时 onOlder 调用次数为 1，预期为 0。候选通过：松手前 0，drag-end 后立即开始，没有一秒延迟。
- 覆盖 early refresh、late refresh、刷新先于观测到 begin-drag、仅松手不刷新、缓存/网络、等待期间 live props 变化、取消/替换、旧 finally 不抢新任务、失焦/后台/卸载/latest 与后续新拖动。
- 使用真实 SDK、真实三段分页和合成 HTTP 响应确认：松手前没有旧历史请求、可见起点不变；松手后取回 3 段并提交一次窗口。原生事件是明确的测试输入，不冒充 iPhone 事件采样。
- 针对性 history/animation **21/21**、完整 mobile **355/355**、TypeScript、iOS/Android Expo 导出及 diff check 通过。原淡入和 tail recovery 回归保持通过。
- 真机事件顺序和视觉体验仍待反馈；标准事件流的正确入口不等于完成全部 iPhone 故障矩阵。

本轮候选在 `jamie/session-history-release-gate` 验证后，经 Jamie 明确要求“部署”，将修正提交 `4ee6650` 快进合入 main 并更新现有手机测试入口。

## 授权发布记录

- 发布目录再次通过 TypeScript 和完整 mobile 355/355；仅重启用户级 `hermes-app-expo.service`。
- iOS/Android 公网 manifest 及各自实际 launchAsset 确认等待 release 的 Promise、drag-end 解开意图、等待后才执行 onOlder、当前 props/请求所有权保护；没有人为定时器。
- 保留 220ms FadeIn、FlashList、3 段分页与独立 tail 恢复；App.tsx、historyBlocks.ts 和共享 SDK 的发布前后 SHA-256 一致。
- Jamie 和开发 Gateway 的 PID、启动时间、状态保持一致；其他任务工作区的两个文档哈希一致，未提交它们。
- 测试入口 `exps://agent.tuly.space`，需要 Expo Go 完整 Reload。物理 iPhone 手势顺序仍待反馈，公网资源验证不等同于真机验收。
- 回滚分支 `rollback/session-history-release-gate-before-4ee6650` 指向发布前 `eaa520b`。只回退本轮客户端文件并重启 Expo，不覆盖其他任务工作区修改。
- 私有发布证据在下方目录 `release/release-verification.json`，含两平台实际 bundle 哈希、检查项、数据流源码哈希及 Gateway 前后状态；另保存发布目录测试日志。
- 无核心/plugin/服务端/依赖变更，未重启 Gateway，未远程推送或发布签名安装包。

证据：`/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/session-history-release-gate/`，含 baseline-red、targeted-green、完整测试和导出记录。
