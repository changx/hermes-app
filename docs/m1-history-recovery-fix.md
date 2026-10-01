# 修复最新数据恢复抢占历史下拉

## 范围与授权

Jamie 要求修复已复现的并行加载路径，改完部署；不允许用每个手势的次数限制掩盖重复触发。基线 `3de1a7f`，调查证据 `10da3e3`。

## 修正

- ThreadScreen 的 tailIncomplete effect 不再调用 openThread，不再清 located、startRef、旧历史 cursor 或递增 openingRef。最新数据修复不再假装重新导航进入页面。
- 新增单独 recoverLatest 数据流程；多次 revision 通知观察同一个进行中的恢复任务，不会创建多个页面恢复流程。失焦、卸载、client/thread 更换时取消该任务。恢复结束不修改正在阅读的窗口；普通下拉继续按 3 个用户起始阅读段分页。
- SDK 保存 historyTail 在预算耗尽时的真实未完成 forward cursor。recoverHistoryTail 从该游标继续，避免直接取 latest 页而跳过中间记录；不根据缓存最大序号猜恢复边界。
- 同一 thread 的进行中恢复调用共享同一个 Promise 和 HTTP 链；任务完成后可以再次执行真实需要的恢复。这是进行中任务所有权，不是手势次数锁、限流或取消正常多页补齐。
- 成功页推进保存的 cursor，失败/取消后可从进度续接。只有 forward 分页确实结束才清 tailIncomplete；循环 cursor、最多 20 页预算、resync epoch 和取消检查防止错误确认或无限请求。
- 原 SDK 背景补齐 3 页预算不变；大批恢复只由聚焦且已打开的聊天页面触发。没有修改 Hermes 核心、plugin、服务端、依赖或桌面 UI。

## 验证

- 修复验收测试针对发布前生产 App 执行时失败：一次下拉期间另起 latest 请求。候选通过：older 和 tail-repair 数据链并行，页面 rows 从不清空，旧历史扩展提交成功，恢复不把起点重置到最新 3 段。
- 两种完成顺序、连续 revision、失败后重试、失焦/返回/卸载、后续普通下拉继续加载另外 3 段均覆盖。
- 真实 SDK 测试覆盖 saved forward cursor、并发调用共享 Promise、成功进度保留、取消/晚到响应、预算后续接、循环 cursor、缺少边界不猜测、旧协议 known-empty 路径、resync 失效。
- 15 项针对性回归、完整 mobile **342/342**、TypeScript（包含共享 SDK 源码）及 iOS/Android Expo 导出、diff check 通过。独立直接 tsc 调用被运行工具的脚本扫描大小限制挡住；改用已执行通过的 mobile 项目类型检查覆盖同一 SDK 源码，没有声称该直接命令成功。
- HTTP/SDK/原生 UI 输入为明确的合成或替代对象，生产 React 页面与 SDK 逻辑实际执行；不是 iPhone 原生事件日志。修复了已复现的恢复竞态，不保证物理设备没有其他刷新触发问题。

证据：`/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/session-history-recovery-fix/`，含 baseline-red / targeted-green / mobile-tests 与双平台导出日志。

候选在隔离分支 `jamie/session-history-recovery-fix` 验证后，按 Jamie“改，改完部署”的授权，将修正提交 `60b5fd4` 快进合入 main，并更新现有手机测试入口。

## 授权发布记录

- 发布目录重建共享 SDK 输出，TypeScript 和完整 mobile 342/342 再次通过；仅重启用户级 `hermes-app-expo.service`。
- iOS/Android 公网 manifest 和各自实际 launchAsset 均确认独立 recoverLatest/recoverHistoryTail、保存的 forward continuation、进行中恢复共享、只在分页结束时恢复事件同步；恢复函数不含 openThread/setLocated/setStartRef/setPageCursor 或 openingRef 递增。
- 保留按 3 段加载和 FlashList。ChatTimeline.tsx 发布前后 SHA-256 完全一致，没有新增手势次数限制。
- Jamie 和开发 Gateway 的 PID、启动时间、状态与本次发布前一致；另一个任务的两个工作区文档 SHA-256 一致，未提交它们。
- 测试入口 `exps://agent.tuly.space`，需要 Expo Go 完整 Reload。物理 iPhone 上是否另有 native 重复触发仍待反馈，不能把已修复的代码竞态等同于全部手势问题已验收。
- 回滚分支 `rollback/session-history-recovery-before-60b5fd4` 指向发布前 `3de1a7f`。只恢复本轮 App/共享 SDK 等文件、重建 SDK 输出并重启 Expo，不覆盖其他任务工作区修改。
- 私有发布证据：上方目录 `release/release-verification.json`，含两平台实际 bundle 哈希、检查项、Gateway 前后状态；另保留发布目录测试日志和原下拉入口哈希。
- 无核心/plugin/服务端/依赖升级，未重启 Gateway，未远程推送或发布签名包。
