# Hermes App 执行约定

## 文档索引

以下为本仓库全部应用 Markdown 文档（不含本执行约定），按目录与主题分组。开工前先读总览及相关专题；历史验证和发布记录仅代表当时结果，不替代当前验收。新增、移动或删除文档时同步维护本索引。

### 总览、需求与开发

- [README.md](README.md)
- [docs/requirements.md](docs/requirements.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/push-notification-design.md](docs/push-notification-design.md)（设计，未实现）
- [docs/core-dataflow.md](docs/core-dataflow.md)
- [docs/development-plan.md](docs/development-plan.md)
- [docs/dev-environment.md](docs/dev-environment.md)
- [docs/dev-lcm-fix.md](docs/dev-lcm-fix.md)
- [docs/p1-plan.md](docs/p1-plan.md)
- [docs/p2-mobile-dev.md](docs/p2-mobile-dev.md)
- [apps/mobile/README.md](apps/mobile/README.md)
- [docs/expo-sdk57-upgrade.md](docs/expo-sdk57-upgrade.md)
- [docs/channel-repository-agents.md](docs/channel-repository-agents.md)
- [docs/channel-primary-path.md](docs/channel-primary-path.md)

### M1 手机聊天、交互与验收

- [docs/m1-agent-reactions.md](docs/m1-agent-reactions.md)
- [docs/m1-agent-settings.md](docs/m1-agent-settings.md)
- [docs/m1-arrival-id-fix.md](docs/m1-arrival-id-fix.md)
- [docs/m1-article-selection.md](docs/m1-article-selection.md)
- [docs/m1-attachment-menu.md](docs/m1-attachment-menu.md)
- [docs/m1-combined-release.md](docs/m1-combined-release.md)
- [docs/m1-composer-attachments.md](docs/m1-composer-attachments.md)
- [docs/m1-composer-blur-background.md](docs/m1-composer-blur-background.md)
- [docs/m1-composer-chatgpt.md](docs/m1-composer-chatgpt.md)
- [docs/m1-composer-latest.md](docs/m1-composer-latest.md)
- [docs/m1-composer-reset.md](docs/m1-composer-reset.md)
- [docs/m1-composer-shadow.md](docs/m1-composer-shadow.md)
- [docs/m1-composer-status.md](docs/m1-composer-status.md)
- [docs/m1-discord-followup-fix.md](docs/m1-discord-followup-fix.md)
- [docs/m1-dismiss-keyboard-on-inactive.md](docs/m1-dismiss-keyboard-on-inactive.md)
- [docs/m1-english-ui.md](docs/m1-english-ui.md)
- [docs/m1-expo-router.md](docs/m1-expo-router.md)
- [docs/m1-file-tool-captions.md](docs/m1-file-tool-captions.md)
- [docs/m1-followup-status.md](docs/m1-followup-status.md)
- [docs/m1-full-markdown.md](docs/m1-full-markdown.md)
- [docs/m1-handoff-reaction.md](docs/m1-handoff-reaction.md)
- [docs/m1-history-enter-animation.md](docs/m1-history-enter-animation.md)
- [docs/m1-history-five-blocks.md](docs/m1-history-five-blocks.md)
- [docs/m1-history-flashlist.md](docs/m1-history-flashlist.md)
- [docs/m1-history-scrollview.md](docs/m1-history-scrollview.md)
- [docs/m1-history-layout-baseline.md](docs/m1-history-layout-baseline.md)
- [docs/m1-history-layout-stability.md](docs/m1-history-layout-stability.md)
- [docs/m1-history-pull-hint.md](docs/m1-history-pull-hint.md)
- [docs/m1-history-pull.md](docs/m1-history-pull.md)
- [docs/m1-history-recovery-fix.md](docs/m1-history-recovery-fix.md)
- [docs/m1-history-release-anchor.md](docs/m1-history-release-anchor.md)
- [docs/m1-history-release-delay.md](docs/m1-history-release-delay.md)
- [docs/m1-history-release-gate.md](docs/m1-history-release-gate.md)
- [docs/m1-history-three-blocks.md](docs/m1-history-three-blocks.md)
- [docs/m1-history-trigger-investigation.md](docs/m1-history-trigger-investigation.md)
- [docs/m1-ios-composer-no-native-blur.md](docs/m1-ios-composer-no-native-blur.md)
- [docs/m1-keyboard-layout.md](docs/m1-keyboard-layout.md)
- [docs/m1-message-animation.md](docs/m1-message-animation.md)
- [docs/m1-midrun-release.md](docs/m1-midrun-release.md)
- [docs/m1-midrun-steer.md](docs/m1-midrun-steer.md)
- [docs/m1-model-font-settings.md](docs/m1-model-font-settings.md)
- [docs/m1-native-command-output.md](docs/m1-native-command-output.md)
- [docs/m1-native-keyboard-release.md](docs/m1-native-keyboard-release.md)
- [docs/m1-native-reactions.md](docs/m1-native-reactions.md)
- [docs/m1-navigation-motion.md](docs/m1-navigation-motion.md)
- [docs/m1-network-loop.md](docs/m1-network-loop.md)
- [docs/m1-network-reliability.md](docs/m1-network-reliability.md)
- [docs/m1-network-time.md](docs/m1-network-time.md)
- [docs/m1-new-topic-resume-layout.md](docs/m1-new-topic-resume-layout.md)
- [docs/m1-origin-display-fix.md](docs/m1-origin-display-fix.md)
- [docs/m1-reliability-verification.md](docs/m1-reliability-verification.md)
- [docs/m1-router-keyboard.md](docs/m1-router-keyboard.md)
- [docs/m1-running-indicator-blur.md](docs/m1-running-indicator-blur.md)
- [docs/m1-send-recovery.md](docs/m1-send-recovery.md)
- [docs/m1-session-list-composer.md](docs/m1-session-list-composer.md)
- [docs/m1-short-list-keyboard.md](docs/m1-short-list-keyboard.md)
- [docs/m1-stable-turn-owner.md](docs/m1-stable-turn-owner.md)
- [docs/m1-tool-timeline.md](docs/m1-tool-timeline.md)
- [docs/m1-usable-chat.md](docs/m1-usable-chat.md)
- [docs/m1-verification.md](docs/m1-verification.md)

### 手机工作区与恢复

- [docs/mobile-background-scene.md](docs/mobile-background-scene.md)
- [docs/mobile-channel-context.md](docs/mobile-channel-context.md)
- [docs/mobile-delete-failed-message.md](docs/mobile-delete-failed-message.md)
- [docs/mobile-failed-send-recovery.md](docs/mobile-failed-send-recovery.md)
- [docs/mobile-startup-receipt-warning.md](docs/mobile-startup-receipt-warning.md)
- [docs/mobile-user-message-block.md](docs/mobile-user-message-block.md)
- [docs/mobile-workspace-entry.md](docs/mobile-workspace-entry.md)
- [docs/mobile-workspace-entry-release.md](docs/mobile-workspace-entry-release.md)
- [docs/mobile-session-options.md](docs/mobile-session-options.md)
- [docs/mobile-battery.md](docs/mobile-battery.md)
- [docs/mobile-pdf-viewer.md](docs/mobile-pdf-viewer.md)
- [docs/mobile-tabs-recents.md](docs/mobile-tabs-recents.md)

### 桌面应用

- [docs/desktop-macos-v1.md](docs/desktop-macos-v1.md)
- [docs/desktop-release-0.1.6.md](docs/desktop-release-0.1.6.md)
- [docs/desktop-release-0.1.32.md](docs/desktop-release-0.1.32.md)
- [docs/desktop-settings.md](docs/desktop-settings.md)
- [docs/desktop-connections.md](docs/desktop-connections.md)
- [docs/desktop-session-composer.md](docs/desktop-session-composer.md)
- [docs/desktop-silent-recovery.md](docs/desktop-silent-recovery.md)
- [docs/desktop-tabs.md](docs/desktop-tabs.md)
- [docs/desktop-browser-control.md](docs/desktop-browser-control.md)
- [docs/desktop-mac-control.md](docs/desktop-mac-control.md)
- [docs/desktop-sidebar-release-0.1.37.md](docs/desktop-sidebar-release-0.1.37.md)
- [docs/desktop-tab-composer-release-0.1.38.md](docs/desktop-tab-composer-release-0.1.38.md)
- [docs/desktop-release-retention.md](docs/desktop-release-retention.md)
- [docs/desktop-chatgpt-composer-release-0.1.39.md](docs/desktop-chatgpt-composer-release-0.1.39.md)
- [docs/desktop-browser-resize-release-0.1.40.md](docs/desktop-browser-resize-release-0.1.40.md)
- [docs/desktop-file-preview-release-0.1.41.md](docs/desktop-file-preview-release-0.1.41.md)
- [docs/desktop-browser-control-release-0.1.42.md](docs/desktop-browser-control-release-0.1.42.md)
- [docs/desktop-recents-indent-release-0.1.43.md](docs/desktop-recents-indent-release-0.1.43.md)
- [docs/desktop-recents-indent-release-0.1.44.md](docs/desktop-recents-indent-release-0.1.44.md)
- [docs/desktop-browser-window-release-0.1.45.md](docs/desktop-browser-window-release-0.1.45.md)
- [docs/message-toolbar-release-0.1.46.md](docs/message-toolbar-release-0.1.46.md)
- [docs/desktop-browser-window.md](docs/desktop-browser-window.md)
- [docs/desktop-session-search.md](docs/desktop-session-search.md)
- [docs/desktop-automations.md](docs/desktop-automations.md)
- [docs/automation-workflow.md](docs/automation-workflow.md)（草案，未实现）
- [docs/automation-editing.md](docs/automation-editing.md)（Automation 创建与编辑设计，未实现）
- [docs/desktop/tree-navigation.md](docs/desktop/tree-navigation.md)

### 共享行为、内容呈现与发布

- [docs/session-links.md](docs/session-links.md)
- [docs/thread-branch.md](docs/thread-branch.md)
- [docs/file-preview.md](docs/file-preview.md)
- [docs/multi-connection.md](docs/multi-connection.md)
- [docs/multi-connection-release-0.1.36.md](docs/multi-connection-release-0.1.36.md)
- [docs/connection-names.md](docs/connection-names.md)
- [docs/full-history-loading.md](docs/full-history-loading.md)
- [docs/generated-titles-search.md](docs/generated-titles-search.md)
- [docs/unified-settings.md](docs/unified-settings.md)
- [docs/session-auto-bottom.md](docs/session-auto-bottom.md)
- [docs/session-open-timing.md](docs/session-open-timing.md)
- [docs/session-labels.md](docs/session-labels.md)
- [docs/todo-flag.md](docs/todo-flag.md)
- [docs/archive.md](docs/archive.md)
- [docs/live-session-pages.md](docs/live-session-pages.md)
- [docs/client-layout-tools-blur-release.md](docs/client-layout-tools-blur-release.md)
- [docs/command-state-order.md](docs/command-state-order.md)
- [docs/completed-unread-directory.md](docs/completed-unread-directory.md)
- [docs/completed-unread-release.md](docs/completed-unread-release.md)
- [docs/history-execution-state-release.md](docs/history-execution-state-release.md)
- [docs/history-execution-state.md](docs/history-execution-state.md)
- [docs/lighter-unread-dot.md](docs/lighter-unread-dot.md)
- [docs/markdown-table-release-0.1.7.md](docs/markdown-table-release-0.1.7.md)
- [docs/markdown-table-width.md](docs/markdown-table-width.md)
- [docs/code-block-wrap.md](docs/code-block-wrap.md)
- [docs/message-hierarchy.md](docs/message-hierarchy.md)
- [docs/reply-models.md](docs/reply-models.md)
- [docs/thread-model.md](docs/thread-model.md)
- [docs/open-session-live-release-0.1.8.md](docs/open-session-live-release-0.1.8.md)
- [docs/open-session-live.md](docs/open-session-live.md)
- [docs/outbound-media-deployment.md](docs/outbound-media-deployment.md)
- [docs/outbound-media.md](docs/outbound-media.md)
- [docs/system-notices-release.md](docs/system-notices-release.md)

### P0 可行性与插件验证

- [docs/p0/README.md](docs/p0/README.md)
- [docs/p0/clients.md](docs/p0/clients.md)
- [docs/p0/close-compaction.md](docs/p0/close-compaction.md)
- [docs/p0/close-mobile.md](docs/p0/close-mobile.md)
- [docs/p0/close-recovery.md](docs/p0/close-recovery.md)
- [docs/p0/final.md](docs/p0/final.md)
- [docs/p0/history.md](docs/p0/history.md)
- [docs/p0/plugin-e2e.md](docs/p0/plugin-e2e.md)
- [docs/p0/plugin-execution.md](docs/p0/plugin-execution.md)
- [docs/p0/plugin-history.md](docs/p0/plugin-history.md)
- [docs/p0/plugin-summary.md](docs/p0/plugin-summary.md)
- [docs/p0/plugin-transport.md](docs/p0/plugin-transport.md)
- [docs/p0/plugin-validation-plan.md](docs/p0/plugin-validation-plan.md)
- [docs/p0/resources.md](docs/p0/resources.md)
- [docs/p0/rooms.md](docs/p0/rooms.md)
- [docs/p0/transport.md](docs/p0/transport.md)
- [probes/p0/close-mobile/README.md](probes/p0/close-mobile/README.md)
- [probes/p0/verification/README.md](probes/p0/verification/README.md)

### P1 协议、客户端契约与验收

- [docs/p1/client-contract.md](docs/p1/client-contract.md)
- [docs/p1/final.md](docs/p1/final.md)
- [docs/p1/first-gate.md](docs/p1/first-gate.md)
- [docs/p1/fourth-gate.md](docs/p1/fourth-gate.md)
- [docs/p1/packaging.md](docs/p1/packaging.md)
- [docs/p1/protocol.md](docs/p1/protocol.md)
- [docs/p1/second-gate.md](docs/p1/second-gate.md)
- [docs/p1/third-gate.md](docs/p1/third-gate.md)

### 桌面验收证据

- [docs/desktop/evidence/DESK-D0-01/verification.md](docs/desktop/evidence/DESK-D0-01/verification.md)
- [docs/desktop/evidence/DESK-D0-02/verification.md](docs/desktop/evidence/DESK-D0-02/verification.md)
- [docs/desktop/evidence/DESK-D0-03/verification.md](docs/desktop/evidence/DESK-D0-03/verification.md)
- [docs/desktop/evidence/DESK-D0-04/verification.md](docs/desktop/evidence/DESK-D0-04/verification.md)
- [docs/desktop/evidence/DESK-D0-05/verification.md](docs/desktop/evidence/DESK-D0-05/verification.md)
- [docs/desktop/evidence/DESK-D0-06/verification.md](docs/desktop/evidence/DESK-D0-06/verification.md)
- [docs/desktop/evidence/DESK-FIX-MARKDOWN-SPACING/verification.md](docs/desktop/evidence/DESK-FIX-MARKDOWN-SPACING/verification.md)
- [docs/desktop/evidence/DESK-FIX-READ-LOOP/verification.md](docs/desktop/evidence/DESK-FIX-READ-LOOP/verification.md)
- [docs/desktop/evidence/DESK-LOAD-FEEDBACK/verification.md](docs/desktop/evidence/DESK-LOAD-FEEDBACK/verification.md)

## 产品边界

- 阅读 README.md 和 docs/ 下的需求、架构、开发阶段文档后再工作。
- 最终交付独立可安装的桌面和手机 App；不能以 Web 页面、PWA 或桌面响应式页面冒充手机 App。
- Discord 是成熟交互和同步设计的参考，不是兼容目标。不要新增 Discord 服务、Discord 协议模拟或完整 IM 平台。
- 用户可见 Thread 是连续对话，底层 session、idle compaction、上下文续接不应破坏或污染历史。
- Hermes 管理项目结构、历史、公共提示、任务执行和同步状态；adapter 只做通信、认证与协议转换。

## 当前首个目标

- 先交付可日常使用的频道、话题和聊天，重视消息上屏、滚屏定位、内容渲染、消息类型样式及手机滚动/键盘体验。先实现可试用结果，再根据 Jamie 反馈迭代，不追求一次完善全部产品能力。
- 首版最高优先级是网络通信可靠性：断网/弱网/切网自动恢复，发送先持久保存，确认丢失使用同ID原文安全重试，前后台/冷启动补齐历史和收据；鉴权失效停止盲重试，执行unknown不得自动重跑。网络故障矩阵与iPhone实测未通过，不得以基本聊天正常宣称首版完成。见 docs/m1-network-reliability.md；视觉迭代不得挤占此优先级。
- 通信恢复默认自动完成，尽量不打扰用户：重连、确认核对、安全重试、历史补齐不要求用户做技术判断；临时故障只给轻量状态，不弹“重试/放弃”或要求手动重建同步。仅确实需要用户动作时给明确下一步；执行结果不明自动核对但不得盲目重跑，不能以静默掩盖失败。
- 用户不负责查找、复制或修复令牌；初次接入通过管理员授权的一次性设备配对，App安全保存设备凭据，正常断线/重启自动恢复。既有开发连接继续兼容；设备撤销不得靠自动重新授权绕过。
- 运行中的 Expo 根目录也是发布来源。未经相应部署授权，候选变更保留在隔离分支，不直接合入运行目录触发热更新。更新手机测试入口时，只发布已验证的客户端与必要开发插件，保留回滚；不顺带升级固定 Hermes 核心或重启 Jamie 主实例。公网资源验证和 iPhone 故障实测分别记录。
- 当前手机采用 Expo/React Native SDK 57 与共享 HermesClient，使用隔离 hermes-app-dev 开发环境（主模型以该 profile 的 config.yaml 为准，见 docs/dev-environment.md）。Expo Go 是当前测试入口，不等于独立安装包交付。
- 桌面、独立签名包、系统推送、复杂搜索/管理和完整附件平台保留后续，不作为本轮聊天体验的前置条件。
- 默认滚屏：新建话题页面定位到最新消息；返回仍存活页面保留原阅读位置和历史窗口。底部跟随；用户上翻停止跟随；新消息提供回到最新入口；主动发送或点击回到最新恢复跟随；加载旧历史保持阅读锚点。频道详情页首帧显示列表底部，话题按最后消息时间从旧到新排列。正常加载不显示“Opening…”一类过程文字，只在确有问题时提示。
- 页面头部入口用紧凑图标（连接、Agent 设置），返回按钮只显示箭头，不显示上一级标题。键盘和动态内容高度变化不得抢走阅读位置。
- 所有存活 session 页面保留各自时间线、历史窗口、阅读位置/跟随状态、草稿、附件和阅读器，并同时订阅。失焦、覆盖或推入另一个 session 不释放内容；页面真正销毁、身份移除或服务端确认目标失效才释放。当前客户端按连接身份＋稳定 Thread ID 保持唯一页面，返回已有页面不重开。切后台暂停连接和读取但保留全部页面；回前台核对各页面原窗口，不重建或跳最新。不新增持久化聊天历史库。见 docs/live-session-pages.md。
- 消息使用稳定身份，乐观上屏与服务端确认合并不重复，不能按相同正文猜测身份。只有真实协议提供草稿时才呈现流式更新，不伪造进度；内部维护和压缩记录不进入聊天正文。

## 用户界面表达

- 全应用面向使用者，不把技术信息当作界面内容。聊天、连接/配对、频道表单、设置、空白页、错误提示和辅助阅读文案都使用用户能理解的任务、结果和操作语言；不展示内部 ID、收据、游标、补齐、令牌、原始异常、诊断路由或开发发布状态。技术诊断只留在开发侧，不另设普通用户可见的技术信息入口。此规则针对应用自带界面，不过滤用户/Agent 消息中的技术讨论，也不省略授权审批所必需的实际操作说明。
- 移除键盘/输入栏上方的常驻发送状态栏和重复队列摘要。消息发送中用浅灰正文，只有权威确认收到后才变为正常实色；不靠计时或 Agent 完成状态推断已发送。浅灰也应可读。
- 发送按钮在当前话题处理中仍保持发送功能，补充内容按 Hermes 原生插入机制接入当前执行；不得将普通排队伪装为已插入。停止保留为独立小按钮，紧跟在输入框上方运行状态行的 `Agent is running` 文字之后（图标＋`Stop` 的描边胶囊），不覆盖发送、不清空草稿，不另设停止工具条。排队取消放在对应消息旁。发送确认后的文字颜色采用短暂过渡，历史不重播，遵从减少动态效果。
- 附件「＋」放在输入框左侧同一行，菜单与附件预览放在上方。运行指示使用 `Agent is running`，设置显示名称后使用 `名字 is running`，保留三个缩放点并由真实状态驱动；Agent 设置提供当前连接的本机显示名称、服务端 Provider/Model 选择和本机界面字体大小。模型选择复用 Hermes 原生切换，明确生效范围；不改服务端人格或认证，不向客户端暴露密钥。字体大小覆盖原生界面和正文阅读器并持久保存。
- Agent 状态仅用对应用户消息下的紧凑 reaction 表达，按真实收据更新；不增加社交表情功能。消息发送状态与 Agent 执行状态分开，状态更新不抢滚动位置。
- Agent 公开的中间说明、工具调用和最终回复按原始顺序展示：说明使用 Markdown 正文，调用使用紧凑操作行，安全命令使用浅底等宽块；全屏阅读保留工具记录。这些执行内容不属于应隐藏的应用内部诊断。具体规则见 docs/m1-tool-timeline.md。
-- 搜索网页记录显示实际搜索词，不能只有“搜索网页”；仅白名单读取 query，敏感内容安全降级，长搜索词明确省略，不输出参数 JSON。Agent 输出在底部自动跟随（含工具追加、同身份更新及最近消息窗口滑动），上翻阅读时不打断；信息流底部保留 96pt 留白，不用 flexGrow 撑满短列表。返回最新按钮放在输入区上方靠右，与输入区共用 KeyboardStickyView 随键盘移动，不挤占输入行。按钮整行透明，允许消息在其后方滚动，空白区域不拦截触摸；按钮本身保留底色。
- 工具记录只表达真实调用，不把调用发出当作执行成功；不展示内部思考、原始参数 JSON、原始工具返回或凭据。命令须通过安全检查和脱敏，未知或敏感工具只显示安全名称/动作。复用原始消息身份和正式插件 hook，实时、历史与重连保持同一顺序且不重复；不伪造逐 token 输出，也不补造未捕获的旧工具记录。
- 执行过程验收必须包含真实联网查询，不能只用终端或合成工具代替。开发实例显式使用普通搜索后端，让调用经过正式 hook；服务端内置搜索不一定保存为普通 tool_calls，不能仅凭空字段判断未搜索。公开 commentary 与正文分开存储时须按明确类型读取，严禁把 analysis/reasoning 当作公开说明。
- 正常恢复不要求用户处理技术问题；确实发送失败、未保存、授权被撤销或需要批准/回答时，用简短自然语言说明实际影响和可行下一步。不通过隐藏错误制造成功假象，保留必要操作和辅助阅读提示。

## 最小有效实现

- 优先复用 Hermes 现有 RPC、共享客户端、历史展示与项目管理逻辑。
- 不重建权威消息数据库；沿用 P0/P1 验证后的插件与共享客户端，新增代码只补当前目标所需的实际缺口。
- 已确认需求与建议/待决项分开记录。架构、接口、平台范围变更同时更新相关文档。
- 项目仓库在 /opt/projects/jamie/hermes-app；隔离 worktree 在 /opt/projects/jamie/_worktrees/hermes-app/<task>。
- 已确认目录要求：Channel workspace 与代码仓库保持分开。仓库为 /opt/projects/jamie/hermes-app；Channel workspace 用于频道资料与任务输出。此项目 Channel 的 AGENTS.md 入口应读取仓库根目录下同一真实 AGENTS.md，不复制另一份规则，也不通过软链接合并目录。仓库 AGENTS.md 独立绑定已由插件实现并在开发 Gateway 中运行（`channel_agents` capability 为 true），见 docs/channel-repository-agents.md。该绑定不意味着客户端可访问整个仓库。Channel 可在 App 中绑定 `/opt/projects` 下的 primary path；AGENTS.md 跟随该路径，Agent cwd 不变，见 docs/channel-primary-path.md。
- 仓库内的项目临时文件使用 tmp/，由根 .gitignore 的 /tmp/ 排除；权威文档留在 docs/，不放入临时目录。运行时工具 scratch 仍遵守 Hermes 提供的 TMPDIR，不擅自修改全局临时目录或其他 profile。
- 新增服务端能力默认通过 Hermes plugin 实现，优先调用已有接口和正式扩展点。不得用 monkey patch 或复制修改核心模块绕过此约束。
- 插件代码在独立仓库 /opt/projects/jamie/hermes-app-plugin（远端 changx/hermes-app-plugin）维护，本仓库不再包含 plugins/hermes_app、scripts/pack-plugin.sh 或 tests/p1。扩展点不足时先报告限制和替代方案，不擅自修改核心。Jamie 明确同意后才可修改核心，并遵守下方「Hermes 核心本地分支」。
- 检查其他会话/任务正在进行的修改；不得覆盖、回退或干扰它们。

## Hermes 核心本地分支

- 核心检出 `~/.hermes/hermes-agent` 运行本地部署主分支 `local/main`。`main` 只镜像上游 `upstream/main`（NousResearch），不放本地提交。`origin` 是 fork，不作为上游。
- 本地改动只以提交形式保留在 `local/main`。改动必须通用、可提交上游（例如由 adapter 显式开启的能力），不写入客户端专用逻辑。
- 本地提交标题以 `local:` 开头。正文写明：需要它的原因、依赖它的 profile 或插件、可以删除的条件（例如上游合入同等功能）。
- 本地改动清单以 `git log --oneline upstream/main..local/main` 为准，不另维护列表。
- 开发在 `jamie/<topic>` 分支和 /opt/projects/jamie/_worktrees/hermes-agent/<topic> 中进行。核心测试的 home I/O 保护拒绝 `~/.hermes` 下的路径，所以测试在 `~/.hermes` 之外的 clone 中运行。Jamie 同意部署后，再把提交 cherry-pick 到 `local/main`。
- 警告：不要在核心检出中运行 `hermes update`。在 fork 检出上，它会把 `main` 强制推送到 `origin`。
- 同步上游的步骤：
  1. `git fetch upstream`，把 `main` 快进到 `upstream/main`。
  2. 从 `upstream/main` 新建候选分支。逐个评估 `upstream/main..local/main` 中的本地提交：上游已有同等功能则删除；配置、插件或 profile 已不使用则删除；保留的 bug 修复先用它的测试在纯上游上确认问题仍存在。
  3. 把保留的提交移到候选分支，测试核心和依赖它的插件。
  4. 向 Jamie 报告保留和删除的提交及理由。Jamie 同意后，旧的 `local/main` 保留为 `local/pre-YYYYMMDD` 回滚分支，再把 `local/main` 移到候选分支。
  5. Gateway 重启由 Jamie 执行。重启后核对运行的提交。
- 本地改动的上游 PR 合入后，下次同步时删除对应的本地提交。

## 授权与安全

- Jamie 已授权 P0/P1 本地实现、隔离开发环境及真实 Codex 联调，并授权继续当前 M1 手机开发与测试。沿用已有 Expo 开发入口；本地实现授权不扩大为生产发布、其他 profile 变更、签名账户操作或 Hermes 核心修改。开发后端安装/重启依具体授权范围执行，不因客户端改动顺带进行。
- 本地开发不等于授权生产配置修改、gateway 重启、公开仓库、推送、签名账户操作或应用商店发布。
- 当前开发 profile `hermes-app-dev` 的插件更新默认由 Agent 自动安装：相关测试与产物校验通过后，主动安装到 `/home/hermes/.hermes/profiles/hermes-app-dev/plugins/hermes-app`，不再等待 Jamie 手动安装或重复确认安装授权。此授权不涵盖其他 profile、Hermes 核心或生产配置；纯客户端改动不安装插件。
- 插件安装与 Gateway 重启分开执行。Agent 保留旧插件代码作为回滚基线，安全替换已验证的插件文件，并回读版本与哈希。Jamie 负责重启 `hermes-gateway-hermes-app-dev.service`；Agent 不自动停止或重启该服务，不用脱离当前进程的子进程绕过限制。
- 安装阶段不主动修改数据库或执行数据迁移。需要迁移时先说明影响与备份要求；代码备份不能冒充一致的数据备份。安装后明确报告“已安装，待 Jamie 重启”，不得称运行中的后端已启用新功能。重启后再验证实际加载版本与相关 HTTP/WS 行为。
- .env、凭据、真实聊天数据与私有诊断放在 /home/hermes/.hermes/profiles/jamie/workspace/hermes-app/，不提交。
- 多端认证与 Channel 编辑权限以服务端校验；公共说明不能覆盖 Hermes 的安全和授权边界。
- 不为实现离线执行全局关闭超时/回收；持久任务生命周期和资源上限必须明确。

## 页面导航

- 页面转场和返回手势使用 Expo 官方导航方案（Expo Router 的原生 Stack），不自制预览页、父页副本或手势切页框架。用户已否决自制 NavigationMotion 方案；不得继续扩展其父页保留或交接机制。
- 接入官方导航前，保留原有页面切换方式；导航变更不扩大为聊天状态、字体、通信或服务端重构。

## 验证和交付

- 文档阶段检查链接、需求覆盖、建议与事实区分，不声称功能已实现。
- 实现阶段必须验证历史/压缩、双客户端、断网/重连、进程重启、幂等与审批竞态。
- 原文消息与模型压缩历史分开；实时展示和重新加载采用同一规则。
- 交付桌面/手机真实安装包并做真实设备验收。只有网页通过不算完成。
- 使用 uv 管理 Python；前端沿用选定基线已有包管理器与依赖，不新增无必要框架。
- 任务完成清理自己创建的临时资源，保留产物、证据与恢复状态。
