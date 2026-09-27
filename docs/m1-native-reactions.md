# App 原生追加与 reaction

本轮替代“交给 Hermes 就显示已处理”的规则。基于 `ff8cfe1`，只本地实现，发布另行授权。

- 文本追加经现有 `MessageEvent → handle_message → Gateway busy` 路径；由 Hermes 配置决定 steer/queue/interrupt，不在 App 自造处理策略。附件保留已有持久上传与普通队列路径。
- reaction 使用与 Discord 相同的正式回调：`on_processing_start` 显示 👀 处理中；`on_processing_complete` SUCCESS 显示 ✅ 已完成、FAILURE 显示 ❌ 处理失败、CANCELLED 移除 reaction。
- steer 追加没有独立回调时，不显示独立 processing/完成 reaction。若 Gateway 让其进入独立处理入口，则按真实回调更新。接收成功与处理开始分开，不将 handoff、原始消息行、压缩历史或轮次关联当作 reaction 证据。
- App 需要跨设备/重启显示回调结果，因此在现有 receipts 增加一个 nullable `processing` 字段，直接持久记录回调结果；不建新表、调度器或状态框架。旧数据默认 null，不反推、不批量修复。现有 state 仍供队列释放、恢复和幂等使用，不再驱动 reaction。
- 正式回调已开始但进程退出时，恢复把 processing=running 改成 unknown，显示轻量“结果待确认”，不假装仍在处理、不自动重跑。这是 App 持久通信所需的故障提示。真实 pending 审批/澄清仍保留。
- 保留 `handed_off` 的旧协议兼容字段，但它不决定 reaction。消息展示位置和核心 context 不变；包括已验证的用户处理归属保护。

验收：真实 GatewayRunner 的普通、同轮多追加、最终回复阶段追加并续轮工具；回调成功/失败/取消/重复；历史结算不能覆盖 reaction；协议校验、同步/冷读、移动生产投影和 outbox；P1 回归。新增测试使用本地模拟提供方，不伪造真实上游验证。

## 本地验证结果

- P1 回归按测试身份合并分批结果：153 项通过。覆盖实际 GatewayRunner、steer/queue/interrupt、多条追加、跨轮工具与崩溃恢复。原先要求纯文本在 App 本地排队的两项恢复测试改用附件，继续验证未派发持久队列；纯文本改由原生 busy 路径处理。
- `bash scripts/client-check.sh /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline`：SDK 24 项基础、17 项可靠性、4 项 processing 回归通过，含迟到 ACK 不撤销成功/失败/取消结果。
- `npm --prefix apps/mobile test`：199 项通过；SDK 与移动端 `npm run check`、SDK build、`git diff --check` 通过。
- 本机证据：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/native-reactions/` 的 `backend-verification.json`、三个 JUnit XML、`client-final.log`、`mobile-final.log`。
- 未发布、未修改线上历史、未做本轮 iPhone 真机验收。升级需同时发布客户端和 App 插件；候选包含此前未发布的 `ff8cfe1` 归属保护。
- 依赖安装沿用锁文件，npm 报告 10 项 moderate 提示，本轮未扩大为依赖升级。AGENTS.md 措辞更新因权限确认超时未写入，现有“按真实收据更新”仍适用；具体回调契约已记录在本文件与 P1 协议。
