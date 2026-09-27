# 运行中输入、完整文章选择与输入框复位：开发发布记录

## 发布范围

Jamie 授权“完成后发布，我测试”。代码 `09d08fc115f7332dbee60056b481cc3e829b357f` 已通过主控复核并发布到 `exps://agent.tuly.space` 的隔离开发入口。

本轮包含：

- 处理中保留发送按钮；停止为独立小按钮，保留草稿。
- 使用普通 MessageEvent → Base.handle_message，与 Discord adapter 相同的 Gateway 原生 busy/steer 路径。
- 人类可读历史逐条保留中途输入，与 Agent 正文、工具输出按展示时序排列；模型内部聚合 steer 不重复展示。精确身份合并，不按正文匹配。
- 运行中补充 reaction 为 👀 已接收，不随主任务结束伪称逐条完成。停止前未消费的原文仍可读取；结果不明不自动重放。
- 客户端必须找到精确历史输入后才清理收到的补充消息本地副本，不能仅凭 received 与一次成功同步清理。
- 多行正文发送清空后恢复单行高度，不重挂输入框、不主动失焦。
- 双击 Agent 正文的全屏文章使用本地 WebView 原生选区与系统菜单；保留格式、表格、本地公式和图表，以及已有独立图表查看能力。

附件加号、相册/拍照/文件、预览和 Agent 本机显示名称为此前已发布功能，本次沿用。

## 实际验证

- 主控后端 P1：135 passed，7 个 aiohttp AppKey 建议警告；真实 GatewayRunner 定向复验 22 项通过。
- 移动：199/199；共享 SDK 24+17；TypeScript 通过。
- iOS/Android Expo 导出通过；公网两平台 manifest 与实际 JS 包均包含本轮功能。
- 公网 API capability 为 durable_fifo_native_steer，隔离开发配置 display.busy_input_mode=steer。
- 真实开发模型联调：创建独立验收话题，Agent 运行受控终端命令期间连续送入两条唯一标记；执行未结束时两条原文已可读取，下一轮模型消费两条并在最终答复确认；同 ID 重试没有重复输入，聚合 steer 没有重复上屏，重读身份和顺序相同。主请求 completed，两条补充 received。验收话题已归档并回读确认。
- 仅重启开发 Gateway 与 Expo；Jamie Gateway 的 PID/启动时间与固定核心提交、工作区状态均未改变。开发 profile 只有 hermes_app 平台，未改变其他平台的 busy 行为。

私有证据：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/m1-composer-reset/` 中 `parent-p1-final.log`、`parent-mobile-final.log`、`parent-client-final.log`、`parent-export-final.log`、`release-verification.json`、`live-verification.json`。

## 手机待验收

重开 Expo 项目载入新版，测试运行中连续发送、停止后发送、输入框清空恢复单行，以及双击正文后的拖动选区与系统菜单。自动化和公网 JS 验证不能代替 iPhone 手势、键盘和系统菜单验收。附件遵从核心现有普通队列行为，不承诺图片在同一模型轮次插入。

## 恢复与资源

发布前配置、四个插件文件及 SQLite 元数据库备份位于私有 `release-rollback/`，版本与进程身份在 `release-before.json`。包含隐私数据，不提交备份。若需回滚，先停止开发入口并保留发布后的数据库；不得在有新消息后直接恢复旧数据库造成数据丢失。原核心库未改写。验收话题归档保留证据，不删除真实聊天。
