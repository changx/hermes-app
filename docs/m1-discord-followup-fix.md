# 对齐 Discord 的追加消息反馈与历史修正

## 范围与决定

Jamie 要求直接复用 Discord 的 MessageEvent → Base.handle_message，追加由 Hermes 原生 busy handler / steer / 后续轮次处理，不另造执行逻辑。本轮不改核心、输入正文或调度策略，只修 App 历史适配与 reaction。主目录的其他文档修改保留。

已核对固定核心 Discord adapter：on_processing_start 加 👀，on_processing_complete 根据实际 outcome 换 ✅/❌；成功 busy steer 提前返回，未经过普通 processing 回调，不能虚构逐条完成。Jamie 最新明确：成功移交给 Hermes 就显示 ✅ 已处理，不等待主轮结束。这里“已处理”只表达移交成功，不表达模型逐条消费或任务执行完成。移交中保留已接收，异常保留真实失败/未知；正常/原生排队回退继续使用真实 processing 生命周期。

## 已见缺陷

- 客户端 statusFor 主动隐藏 received+followup，导致状态消失。
- 核心最后工具后剩余 steer 作为下一 user turn 处理，未保留普通 platform_message_id/display_kind；App 将内部续接行重复发布为用户输入。每条原始输入已经有稳定 receipt-backed 展示，不需要再次展示核心内部拼接内容。
- 工具 hook 使用旧 pending ingress 作为新 turn 用户锚点，可重复插入已经引用的 row_id，UNIQUE 错误反过来破坏工具执行。应修正归属和安全的幂等投影，不吞掉所有数据库错误或取消身份约束。

## 验收

- 真实隔离 GatewayRunner：工具间追加仍交给下一模型请求；最后工具后追加走核心正常续轮；后续工具成功，用户原文仅一次，不暴露内部来源包装。
- 同 ID 不重派；不同 ID 相同正文各保留；停止前未消费仍保留原文与真实状态；冷读/分页/搜索一致。
- reaction 在成功移交后立即显示 ✅ 已处理，不等待主轮结束；移交异常不能标成功。真实 lifecycle 可更新正常回退的反应，不靠正文或定时器猜测消费。
- 完整 P1、客户端/移动相关回归、类型检查、双平台导出后更新隔离开发入口；Jamie 主实例与固定核心不变。真机体验由 Jamie 测试。
