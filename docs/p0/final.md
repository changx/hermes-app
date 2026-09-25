# P0 收尾结论与 P1 开工门槛

## 决策

**P0 技术调查与隔离验证完成；建议有条件进入 P1 插件实现。不是所有产品验收通过，也不是客户端完成。** 当前已有足够证据选择插件入口、数据权威和双端技术路线。未完成能力已明确归入 P1 实现验收或 P2/P3 设备/上游条件；没有以修改 Hermes 核心作为解决方案。

- 桌面：Electron/React；手机：**Expo/React Native**。共享纯 TypeScript 协议与状态规则，不强行共享桌面 DOM。Flutter 的多端能力成立，但要重写现有 TS/桌面资产，本项目不选它作为首发路线。
- 服务端：独立 Hermes App platform plugin，正常接入 GatewayRunner，插件自有 HTTP/WS。Hermes Project/SessionDB 仍为项目与正文权威。
- 新增最小状态：Thread/lineage 与逻辑消息引用、初始化 Description 快照、接收/outbox 状态、同步/已读游标、附件引用。不能把 hosted Discussion 的策略当作 App FIFO，也不复制第二个权威 transcript。
- **第一开工门槛：P1-01/02 必须证明稳定 Thread、压缩后顺序与消息身份、初始说明继承。** 未通过时暂停后续同步/UI 集成，重新评估插件读取/映射方案，不擅自改核心。P1-03 的崩溃恢复是第二道门槛。

## 主控复核

固定核心：`2f16a1aa5a35feec496949abdef7ad51aea0e7ef`。三路提交已审阅并整合，主控在独立 worktree 实际重跑。入口：

```sh
uv run --no-project --offline \
  --python /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline/.venv/bin/python \
  probes/p0/close-verify.py
```

[机器结果](../../probes/p0/close-verification/results.json)；[可执行主控脚本](../../probes/p0/close-verify.py)。主控脚本的成功表示**证据重现与清理完成**，明确不表示所有产品断言通过。compaction 子命令退出 1 保留在结果中，没有变成通过。

### 压缩与 Description

- 真正执行 AIAgent 压缩和下一轮 idle 入口，向本机合成 summarizer 发实际 HTTP 请求，并提交真实 SessionDB。除了显式物理 rotation，还补测默认 `in_place:true`；共四个模式。未调用付费模型或 native Responses。
- 默认原地压缩不更换 Session ID，本次新 Agent/重建后初始 Description 仍在。物理 successor 的提交头部本来正确，但旧 fixture 只按父物理 ID 保存快照，新 ID 重建时查不到说明。因此稳定 Thread/lineage 映射是插件必需工作，不能逐消息重贴来规避。
- 主控定位到 fresh-agent 完整头部未复用还受到**测试 cwd 变化**影响：存储 cwd 是探针目录，新 Agent 解析为临时 HOME；模型/provider 相同，`_stored_prompt_matches_runtime` 因 cwd 不同返回 false。这不是“同条件冷恢复必然丢头部”的证据。此前正常 Session 冷进程恢复字节一致的通过结论仍有效。
- 调用经过正常 `tui_gateway.server` 绑定的完整 `_history_to_messages` 后，压缩前 32 条可见消息，rotation/idle 后 34 条，原地模式后仍为 32 条但顺序改变。protected head 被移到较后位置，rotation 另有尾部重复。该 fixture 下严格前后序列不相等，**不能将原始 get_messages_as_conversation + 现有显示 shaping 直接作为 App 连续历史 API**。
- 这是 direct-agent/DB/显示转换的实测，不是完整 GatewayRunner 压缩 UI 的最终归因；parent 原始记录保持可读，支持 P1 以原始记录和稳定映射构造展示，而不是改模型压缩逻辑。旧历史、分页边界、同文多消息和原始顺序均需 P1-02 实测。

详细证据：[close-compaction.md](close-compaction.md)，`rotate/idle/inplace/inplace_idle.json`。四个模式均保留严格显示序列失败，不作产品验收通过。

### 持久同步与故障边界

- 主控走真实内建 `groups.*` handler、hosted service 与 worker，执行器为明确标注的合成替身；不是单独测存储函数。
- 同 ID 重试去重、不同 ID 同文本的新发送、冷进程日志分页和两个独立进程 reader 均实测。布置“事件已存、未入队”状态后，重启 service 可补建执行；不应再把两个 DB 提交的局部窗口表述为整个 Hermes 不可恢复。
- Discussion 调度可能合并/静默轮次，不保证每条发送 FIFO 执行；`accepted` 不是完成回执。P1 选择最小插件接收/outbox 元数据桥，复用已有原语和恢复规则，不将整套多人 Discussion 原样作为 Thread 后端。
- 补充回归 **19 passed**。覆盖 group 去重/终态重发布/未知运行保护、进程内审批和 cron durable delivery 边界。未在真实 `send()` 提交间 SIGKILL，未证明双 TCP WS 持久同步或真实工具 exactly-once；这些是 P1-03/04 故障测试，不能用合成结果冒充。

详细：[close-recovery.md](close-recovery.md)。

### 双端复用

- 主控重新执行 Metro Android JS 导出，真实 Hermes SDK 入口进入 RN bundle；导出字节数 2,716,302，纯协议内存测试 5 项通过。保留现有依赖，没有重装或改共享 Hermes 环境。
- 这只是 Android **JS 导出**，不是 APK、设备运行、键盘/长列表/推送验收。Flutter 只做官方资料比较，没有性能实测。
- 原 Linux `.deb` 是已执行过的合成诊断壳，不能作为生产沙箱验证。Android Java/SDK、iOS/Xcode/签名及真机验收留在 P2/P3；不为了 P0 结束而假造手机安装结果。

详细：[close-mobile.md](close-mobile.md)，原打包证据 [clients.md](clients.md)。

## 最终需求覆盖与承接

下表的“P1/P2 门槛”不是已完成结果。每个最终验收均有对应证据和明确承接任务。

| 验收 | P0 结论 | 承接/通过条件 |
| --- | --- | --- |
| A01 独立安装 | Linux 诊断包可启动，Expo Android JS 可导出；无 APK/iOS/正式桌面验收 | P2/P3：目标 OS 真机安装、启动、升级；不能用 JS/PWA 替代 |
| A02 Channel/Thread 隔离 | Project CRUD、跨 Channel 提示和 Session 隔离已测；正式稳定映射未做 | P1-02：同 Channel 多 Thread 与跨 Channel 隔离完整验证 |
| A03 Session 头部与压缩 | 正常头部/冷恢复已测；原地模式说明保留，物理 successor 快照缺口 | P1-02：初始快照按逻辑 Thread 继承、相同 runtime cold restore、rebuild 不重复 |
| A04 连续历史 | 原文存在；实压缩后的显示顺序/重复负例已复现 | P1-02：原始顺序、稳定 ID、有界跨段页、隐藏 scaffolding，逐条前后相等 |
| A05 双端在线同步 | 双 WS 合成 ring 通过，独立进程持久读通过；不是同一完整链路 | P1-03/05：真实 Agent final + 双认证客户端持久增量与重启同步 |
| A06 离线继续 | 真实 GatewayRunner/AIAgent+本机模型在 TCP 断开后完成并入库 | P1-03：延长运行、限流/超时/停止与离线独立，资源有上限 |
| A07 幂等 | 原 RPC ID 非发送幂等；groups event ID 去重可用 | P1-03：客户端发送 ID、持久接收与重试、正文/入队核对，不重复执行 |
| A08 长离线/重启 | 持久 room 日志/冷读、service 未入队补偿通过 | P1-03：实际崩溃窗口、未知执行状态、游标失效重建；不盲重试工具 |
| A09 后台主动结果 | cron delivery/队列原语与回归通过，App 历史链路未实现 | P1-04：隔离 scheduler fire 到正确 Thread 并持久化；推送 P2/P3 |
| A10 审批/澄清 | 进程内 first-response-wins、旧决定保护已有 | P1-04：双端撤卡、执行代际绑定、重启旧卡失效或重新询问 |
| A11 已读一致 | 插件元数据游标单调、冷读已有探针 | P1-03：按可见消息计算未读，双端乱序不倒退 |
| A12 手机后台/附件 | JS 编译不是设备后台保证；一次性 browser artifact 非聊天附件 | P1-04 持久附件；P2/P3 AppState/杀进程/通知/系统权限真机验证 |
| A13 身份隔离 | fixture token/伪 profile 拒绝、隔离 loader 通过 | P1-01/05：固定单 owner/profile、真实 HTTP/WS 授权、缓存隔离与撤销 |
| A14 最小复用 | 原 adapter/平台原语可复用；没有重建 Agent 或 Discord 协议 | P1 全程：既有平台回归、SessionDB 唯一正文权威，无并行聊天库 |
| A15 plugin-only | 正式 loader/平台注册/HTTP handler/system section 均实测，核心未改 | P1-01/05：实际插件包隔离安装/停用/卸载、关闭 listener，无 monkeypatch |

## 为什么此处结束 P0

P0 的目标是验证复用路线与找出缺口。现在继续把映射、队列、持久同步或客户端 UI 做到产品验收通过，会进入用户尚未授权的 P1 实现范围。上述负例不能掩盖，但也不应把“功能尚未实现”变成无限延长 P0 的理由。

当前未发现必须修改核心才能继续的确定障碍；**仍有需要 P1 最小实现证明的可行性风险**，尤其是稳定历史映射与跨存储恢复。采用分段开工门槛限制风险，不承诺未经实测的最终可靠性。

P1 计划见 [p1-plan.md](../p1-plan.md)。建议先批准并完成 P1-01/02，再验收是否继续 03–05。P1 代码、生产安装和发布均未启动。

## 资源与维护

- 复核时核心 tracked source 干净，临时 HOME/数据库已清理，模型 server 与 probe 进程已退出。
- 保留原始子代理提交和失败证据；主控追加诊断未改核心。主控初次运行遇到 `/usr/bin/npm` 不存在及直接导入未绑定显示 helper 的 NameError，改为已安装 Node 实路径与正常 server 绑定入口后重跑；这些属于探针接线问题。
- Expo 依赖保留在 `/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/p0/close-mobile`，用于复现；主仓库只保留源码/锁文件/证据，不提交 node_modules 或 JS dist。
- 既有只读 Hermes 基线和诊断安装包保留供复现。工作树与打包 staging 在收尾时按任务所有权清理，不删除未知或其他任务资源。
