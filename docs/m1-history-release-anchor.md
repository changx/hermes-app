# 下拉历史：松手位置锚点修正

## 用户确认的交互

旧历史插入当前记录前面。记录松手时上边拉开的高度，松手后保留原消息在该屏幕位置，更早消息填入其上方；不是恢复下拉前的位置，也不是直接设置原 contentOffset。不将消息强行居中：拉到哪里，就保持在哪里。

## 候选实现

- 记录原生 drag-end 的未截断 contentOffset（包括负的下拉高度）。
- 加载前按稳定消息 key 和真实 measureInWindow 几何选取靠近中部的可见消息，保留相对列表视口的坐标；若测量发生在回弹之后，根据已经回弹的距离补回松手高度。
- 支持 onRefresh 先于 drag-end 的顺序：以最终松手高度校正锚点，不能用触发刷新阈值的高度代替。
- 沿用原分页和消息顺序。FlatList 的 CellRendererComponent 只替换原 cell 容器，透传原 style、layout 与焦点处理，不改变消息气泡/系统通知布局；容器不折叠，提供可测量的真实原生节点。
- 原生 maintainVisibleContentPosition 继续处理 prepend。加载指示收起、cell/content 布局和回弹后，测量同一 key；仅在真实坐标偏差超过 0.5pt 时进行不带动画的补偿，避免原生已保持位置时重复补偿。
- 下拉回弹不重入跟随最新。下一次主动拖动、点击 latest/主动发送、失焦或卸载取消锚点，不与用户手势竞争；键盘动画期间不进行锚点补偿。
- 很短/耗尽的历史若不足以填满拉出的高度，不反复发出越过内容边界的滚动命令。

## 验证与边界

真实组件回调配合明确标注的原生测量模拟验证：prepend 后同一消息/同一屏幕坐标、松手高度保留、测量晚于回弹、刷新早于松手、原生已正确保持不重复补偿、上方高度变化、新手势接管和失焦取消。已有历史锁/进度/失败后重试测试继续执行。

完整 mobile 313 项测试、TypeScript、iOS/Android Expo 导出及 diff check 通过。首次使用额外 renderItem 包装层导致 3 项消息布局测试失败；改为保持原 cell 结构的 CellRendererComponent 后通过。没有修改依赖或协议。

本轮候选在隔离分支 `jamie/session-history-anchor` 验证后，经 Jamie 明确要求“发布”，将提交 `b8b7be7` 快进合入 main 并更新手机测试入口。iPhone 的真实松手高度、原生 refresh dismissal 和动态 Markdown 高度仍待真机测试；模拟测试不等同于真机无跳动验收。

## 授权发布记录

- 仅重启用户级 `hermes-app-expo.service`；Jamie 和开发 Gateway 的 PID、启动时间、运行状态保持不变。
- 发布目录重新执行 TypeScript、完整 mobile 313/313 测试通过。
- 公网 iOS/Android manifest 与各自实际 launchAsset 均确认 SDK57、现有 Expo 账户、测量 cell renderer、松手高度校正及回弹距离补偿。公网资源通过不等同于真机体验通过。
- 测试入口保持 `exps://agent.tuly.space`，需要在 Expo Go 完整 Reload。
- 回滚分支 `rollback/session-history-anchor-before-b8b7be7` 指向发布前 `e6272fc`。恢复时仅回退本次客户端变化，不覆盖其他任务工作区文件。
- 发布期间原有 `docs/dev-environment.md` 和 `docs/dev-lcm-fix.md` 非本任务修改完整保留，发布前后 SHA-256 核对一致。
- 私有证据：`/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/session-history-anchor/release/release-verification.json`，包含两平台 bundle 哈希、Gateway 前后状态、测试日志。
- 未推送远程、未发布签名安装包、未升级 Hermes 核心或修改服务端。

参考：React Native [ScrollView](https://reactnative.dev/docs/scrollview#maintainvisiblecontentposition)（本轮读取）；本地核对当前 RN Fabric 原生位置保持算法和键盘组件透传。没有改依赖源码。
