# 插入消息 reaction 修正

## 已确认范围

Jamie 真机反馈：Agent 已回应运行中插入的内容，消息仍挂着“已接收”。只调整客户端展示，不修改 Gateway、收据、插入调度或历史身份。

- `queued`：⏳ 排队中。
- `running + admission:followup`：⚙️ 处理中；表示该轮仍在运行，不保证模型已逐条读取。精确关联的待审批/待回答继续优先。
- `received + admission:followup`：本轮已经结束，撤掉临时 reaction，不伪称逐条完成。遗留 `completed + followup` 同样撤掉；正常回退清除 admission 后仍显示真实 completed。
- failed/interrupted/unknown：保留真实异常提示。
- 普通独立消息和收据尚未补齐时的行为不变。保留状态固定占位，避免状态撤掉时改变消息高度；正文、精确身份、发送颜色、原文保留和重试逻辑不变。

## 验收

运行中→received 的生产 timeline 与消息组件测试；冷恢复与乐观/历史合并；主请求完成不提前改变插入消息状态；queued/异常/审批/普通完成保持原有语义；不重发、不删除消息。移动端全量测试、TypeScript 和双平台构建；开发发布只更新 Expo，两个 Gateway 不重启。iPhone 视觉仍由 Jamie 验收。

## 本地验证结果

回归在旧实现下出现 5 项预期失败，修正后移动全量 **200/200**、TypeScript 与 diff 检查通过；干净离线安装及 iOS/Android Expo 全平台导出成功。生产修改仅 `apps/mobile/src/timeline.ts` 的状态映射，未修改后端、SDK、outbox 或滚动组件。此规则替代此前 `m1-midrun-steer.md` 中始终显示“已接收”的客户端 reaction 设计，其余协议不变。
