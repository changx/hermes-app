# Hermes App

独立的 Hermes 桌面客户端与手机客户端。借鉴 Discord 成熟的频道、话题与异步消息体验，减少设计试错；不复刻 Discord 服务，不实现 Discord 协议兼容层。

## 当前状态

- P0 与 P1 本地交付已完成。主控独立验收：43 项 Python、17 项 TS、严格历史 gate、解包插件真实 Gateway 双端联调与 Metro Android JS 导出通过。交付插件和共享协议/测试客户端；正式桌面/手机 App 尚待 P2/P3，不能把测试客户端当正式 App。详见 [P1 最终验收](docs/p1/final.md)。
- 产品核心：Channel 公共上下文、Thread 连续对话、独立于客户端在线状态的异步同步。
- Hermes 是数据与执行的权威服务端；客户端与通信 adapter 不维护第二套权威业务数据。
- 最终必须交付可安装的独立桌面 App 和手机 App；Web/PWA 只可用于中间验证，不能替代最终交付。

## 文档

- [设计需求](docs/requirements.md)：已确认目标、功能需求、建议与待决项。
- [架构与复用评估](docs/architecture.md)：现有 Hermes 能力、缺口、候选实现路线。
- [开发阶段与验收](docs/development-plan.md)：实施顺序、测试矩阵、下一步。
- [项目执行约定](AGENTS.md)：范围、安全、变更与验证规则。
- [P0 收尾结论](docs/p0/final.md)：主控复核、已知负例、最终验收承接及技术选型。
- [P0 插件限定验证](docs/p0/plugin-summary.md)：逐项历史证据、缺口与未验证边界。
- [P1 实施计划](docs/p1-plan.md)：插件与同步契约、任务顺序、开工门槛和工作量区间。
- [P1 第一 gate 记录](docs/p1/first-gate.md)：插件历史实现、隔离测试、已通过范围及剩余边界。
- [P1-03 协议](docs/p1/protocol.md)与[第二 gate 记录](docs/p1/second-gate.md)：持久收据、故障恢复、同步与本地证据。
- [P1-04 第三 gate](docs/p1/third-gate.md)、[P1-05 第四 gate](docs/p1/fourth-gate.md)与[共享客户端契约](docs/p1/client-contract.md)：交互、附件、主动投递、测试客户端与集成限制。
- [开发环境](docs/dev-environment.md)与[P2 Expo 手机开发版](docs/p2-mobile-dev.md)：隔离后端、手机测试链接、运行方法和未完成验收。
- [macOS 桌面 App 第一版设计](docs/desktop-macos-v1.md)：已确认方向、三栏交互、Electron 安全边界、实施阶段与真机验收。

## 项目跟踪

- Hermes 项目：`hermes-app / p_212cf0b9`，主目录 `/opt/projects/jamie/hermes-app`。
- 初始化任务：Hermes Kanban `default / t_94cc1d1e`。
- 需求来源：Jamie 与 Tuly 的 Discord 设计讨论，线程 `1552884015143583759`。
- 文档建立：2026-09-24（PDT）。
- 当前授权：P1 本地插件与共享契约实现、隔离验证；另已授权新建 `hermes-app-dev` 开发 profile、使用内置 OpenAI Codex、安装插件并以 `agent.tuly.space` 提供开发 API。开发环境验收状态见 [开发环境](docs/dev-environment.md)。不包括 Jamie 等现有 profile 变更、远端建仓或正式 App 发布。

## 下一步

P1 已验收；P2 已实现首个 Expo 原生手机开发界面，公开测试入口已启动，尚待真实设备与模型联调完成；不代表独立安装包或 P2 全量功能完成。Description 仅全新逻辑会话注入一次、压缩后不补入。桌面 UI、设备安装包与完整真实设备验收仍是后续工作。
