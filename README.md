# Hermes App

独立的 Hermes 桌面客户端与手机客户端。借鉴 Discord 成熟的频道、话题与异步消息体验，减少设计试错；不复刻 Discord 服务，不实现 Discord 协议兼容层。

## 当前状态

- P0 技术调查与隔离验证已完成；P1-01/02 本地插件已有原始行引用历史读取，真实合成模型运行验证了原地、idle 压缩与物理续接的稳定序列。自动 preflight 曾单次通过但重跑失败；midturn 自动压缩和 GatewayRunner 早期失败后的用户行映射也未通过 gate。P1 后续同步能力未实现。没有正式桌面/手机 App；现有安装包仅为 P0 合成诊断壳。
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

## 项目跟踪

- Hermes 项目：`hermes-app / p_212cf0b9`，主目录 `/opt/projects/jamie/hermes-app`。
- 初始化任务：Hermes Kanban `default / t_94cc1d1e`。
- 需求来源：Jamie 与 Tuly 的 Discord 设计讨论，线程 `1552884015143583759`。
- 文档建立：2026-09-24（PDT）。
- 当前授权：P1 本地插件与共享契约实现、隔离验证；不包括活动 profile 安装、生产变更、远端建仓或发布。

## 下一步

继续收口 P1-02 自动压缩及早期失败晚写边界；Description 仅全新会话注入一次、压缩后不补入。P1-02 gate 通过后再推进持久同步、交互和共享客户端契约。生产安装/发布另行授权。
