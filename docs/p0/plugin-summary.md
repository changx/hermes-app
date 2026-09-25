# P0 插件限定验证汇总

> 本表保留各分路范围。P0 收尾已完成，最终决策、主控补测与验收承接以 [final.md](final.md) 为准；完成的是调查验证，不代表表中产品缺口已实现。

## 判断

**已证明无需修改 Hermes 核心就能加载插件、增加通信入口、接入平台 adapter，并从插件调用部分现有数据能力。尚未证明全部产品要求可由当前插件扩展点完整满足。** 本文记录 P0 能力与缺口，不是 App 或 P1 后端交付声明。

固定 Hermes 基线：`2f16a1aa5a35feec496949abdef7ad51aea0e7ef`。主控在独立集成 worktree 审阅三路源码后重新运行探针：通信 22 项断言、历史 19 项检查、执行/提示/审批/cron 边界探针均退出 0；定向上游回归 55 passed。检查数包含对缺口的负例验证，不代表产品能力全部通过。没有付费模型/真实工具调用、生产部署或核心修改。另见 [真实执行补充](plugin-e2e.md)：真实 GatewayRunner/AIAgent 配合本机合成模型已通过，Session 头部正常续聊/冷恢复/受控重建已验证，补充上游回归 14 passed。

主控命令：

```sh
uv run --no-project --offline \
  --python /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python \
  probes/p0/plugin-verification/verify.py
```

[主控机器证据](../../probes/p0/plugin-verification/results.json) 与同目录日志保存真实命令、退出码和前后核心洁净状态。Hermes 在部分导入路径把 stdout 转到 stderr，因此日志必须保留两者，不能仅凭 stdout 为空判断未执行。

## 全项覆盖

范围来自 [验证计划](plugin-validation-plan.md)。一行对应一个范围条目；“已实测”仅限该行列出的边界。

| 条目 | 已实测证据 | 缺口或未验证边界 |
| --- | --- | --- |
| T01 插件生命周期 | 真实 manifest/loader/register/factory；启动、显式 disconnect、禁用/重启用 | 禁用注册不自动证明活动 adapter listener 已停止；生产启停需要明确顺序 |
| T02 通信入口 | 真实 loopback HTTP/WS；API Server 原生 handler factory 挂载插件路由；Dashboard API 插件加载 | 还未统一选定运行宿主、远程认证/TLS/配对；无需再增加 Discord 协议层 |
| T03 身份与认证 | 缺失/错误 token 拒绝；fixture 外人/伪 profile 拒绝；插件注册按 HERMES_HOME 隔离 | fixture 自己的授权不是核心多用户 ACL；单 owner 多设备与多用户权限必须区分 |
| T04 双端与重连 | 插件合成事件经过真实双 WS，断线后按游标补齐 | 只测进程内 ring；尚未把 Agent 最终输出、持久日志与跨重启同步联成一条链 |
| T05 附件 | 原生 browser artifact 一次性上传/下载；插件微型内存附件边界负例 | 原生接口不等于持久聊天附件；需 Thread 归属、授权、持久引用和清理规则 |
| T06 RPC 扩展 | 未注册方法返回 -32601；插件 HTTP/WS 替代入口实测 | 未发现公开的 TUI JSON-RPC method 注册 API；不允许改内部 method 表冒充插件扩展 |
| H01 项目与 Thread | 插件路由调用现有 Project CRUD/改名/说明/归档 | Project↔稳定 Thread↔session lineage 映射尚未实现 |
| H02 连续历史 | 跨压缩段显示原文，排除摘要/hidden/branch | 整条历史物化；缺有界跨段分页、稳定逻辑消息 ID 与流式归并 |
| H03 持久同步 | 内部 Room 日志游标/快照后增量/冷进程重开 | 补充真实 groups/service 与冷进程分页/reader 已测（close-recovery）；仍非双 WS 完整同步，过期日志/删除/背压待 P1 |
| H04 接收与入队 | Room 发送幂等与 driver admission 各自幂等 | close-recovery 已证明 service 可补偿布置的已接收未入队状态；不是提交间实际 SIGKILL，也不保证 App FIFO |
| H05 已读与搜索 | 插件元数据游标单调、进程重开；核心搜索原语可调用 | 无完整 Thread 级已读/未读/有权搜索；控制事件序号差不等于未读消息数 |
| H06 数据生命周期 | 删除核心 session 后插件游标仍存在；disable 路由不删元数据 | 映射清理、保留、导出与权限需明确；不可复制整套权威聊天库规避问题 |
| E01 执行入站 | 正常平台注册；补充探针经过真实 GatewayRunner.start 与 AIAgent、loopback 合成模型及 SessionDB | 未调用真实工具；入站 accepted 标志不等于持久接收回执 |
| E02 公共上下文 | 正式 system prompt section：每 Session 初始化一次、正常续聊字节一致、冷恢复无 callback、受控重建只保留一份初始说明 | close-compaction 已实跑本地合成 summarizer/idle/default in-place 与 rotation；后者快照映射及展示顺序/重复负例仍在，native upstream 未测 |
| E03 离线任务 | 补充探针真实 TCP 断开时模型仍被门控；放行后真实 Agent 完成并持久化，冷读一致 | 短时断线不是跨重启任务恢复；忙时追加/steer 不等于持久 FIFO，资源上限未验收 |
| E04 故障与历史 | 合成异常正确通知；子进程崩溃无假恢复承诺 | 接收/执行/最终历史原子边界尚未建立，不能盲重跑结果不明的副作用任务 |
| E05 审批与澄清 | 核心进程内 first-response-wins、迟到拒绝；插件 observer hooks | 真正多端撤卡、跨重启恢复未证明；显示待审记录不等于能够恢复已消失的执行等待者 |
| E06 后台投递 | 真实 cron delivery 函数将合成结果送至插件的正确 Thread | 未运行实际 scheduler fire/后台 watcher 全链路、持久历史写入、APNs/FCM 真机 |

分路证据：[通信与认证](plugin-transport.md)、[历史与数据](plugin-history.md)、[执行与提示](plugin-execution.md)。此前 [普通 session transport](transport.md)、[连续历史](history.md)、[Room 持久原语](rooms.md)、[客户端打包](clients.md) 的边界仍适用；不同入口的保证不能拼接成不存在的端到端通过结论。

## 最小实现方向（建议，尚未进入 P1）

1. **入口**：独立维护 Hermes App platform plugin，使用正常 adapter ingress/send；现有可用接口直接复用，新增通信走正式插件入口，不扩写 TUI 核心 RPC 表。先确定单一宿主，避免同时依赖多个 dashboard/gateway 服务。
2. **数据**：现有项目/会话仍是权威来源；插件仅持有所需 Thread 映射、逻辑 ID、接收状态、读取游标及附件引用等最小元数据。采用内部模块前记录版本边界与回归测试，不能把“Python 可导入”当稳定 API 承诺。
3. **可靠性**：先证明接收、执行入队、历史写入和增量游标间的失败恢复规则。对于结果不明任务显示 interrupted/unknown 并核对，不宣称工具副作用 exactly-once；检查 Hermes 已有 startup auto-resume 行为是否与策略一致。
4. **审批**：在线审批可复用核心现有决议；进程已重启导致执行等待者消失时，旧卡必须过期或重新发起，不可把旧同意静默应用到新执行。
5. **验收**：真实 runner + 合成模型响应已补齐。下一条应以同一逻辑 Thread 的实际压缩/物理 successor、持久接收与重启恢复为重点，不再重复测握手或普通 prompt 注入；手机后台/推送须设备证据。

## P0 已收口；产品缺口转入实施验收

- `plugin-e2e`、压缩/idle 负例、hosted service 恢复及 Expo 导出均已主控复核；稳定历史/快照映射、执行崩溃窗口和持久双端最终链路归入 P1-02/03。旧 gated 与压缩失败保留，不按通过统计。
- 推荐 Expo/RN 手机 + Electron 桌面；主控 Metro Android JS 导出和纯协议 5 项测试通过，真机键盘/滚动/附件/推送仍未验收。
- Android 原打包探针因 Java/SDK 缺失没有 APK；iOS/签名/商店分发未进行。Linux `.deb` 只是合成诊断壳。
- P0 调查可关闭，P1 规划已定稿、实现未开始；不安装活动插件或部署，不能写成“底层产品能力已全部就绪”。
