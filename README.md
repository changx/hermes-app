# Hermes App

独立的 Hermes 桌面客户端与手机客户端。借鉴 Discord 成熟的频道、话题与异步消息体验，减少设计试错；不复刻 Discord 服务，不实现 Discord 协议兼容层。

## 当前状态

- 项目已初始化，当前交付是需求与开发设计文档；尚无应用实现或安装包。
- 产品核心：Channel 公共上下文、Thread 连续对话、独立于客户端在线状态的异步同步。
- Hermes 是数据与执行的权威服务端；客户端与通信 adapter 不维护第二套权威业务数据。
- 最终必须交付可安装的独立桌面 App 和手机 App；Web/PWA 只可用于中间验证，不能替代最终交付。

## 文档

- [设计需求](docs/requirements.md)：已确认目标、功能需求、建议与待决项。
- [架构与复用评估](docs/architecture.md)：现有 Hermes 能力、缺口、候选实现路线。
- [开发阶段与验收](docs/development-plan.md)：实施顺序、测试矩阵、下一步。
- [项目执行约定](AGENTS.md)：范围、安全、变更与验证规则。

## 项目跟踪

- Hermes 项目：`hermes-app / p_212cf0b9`，主目录 `/opt/projects/jamie/hermes-app`。
- 初始化任务：Hermes Kanban `default / t_94cc1d1e`。
- 需求来源：Jamie 与 Tuly 的 Discord 设计讨论，线程 `1552884015143583759`。
- 文档建立：2026-09-24（PDT）。
- 本次范围：本地项目初始化、需求整理；不代表授权功能开发、生产变更、远端建仓或发布。

## 下一步

进入 P0 技术验证：在隔离环境证明连续历史、客户端离线后的执行与消息同步、Channel 提示继承，以及桌面/手机可复用边界。先验证关键风险，再确定实现细节与工期。
