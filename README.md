# Hermes App

独立的 Hermes 桌面客户端与手机客户端。借鉴 Discord 成熟的频道、话题与异步消息体验，减少设计试错；不复刻 Discord 服务，不实现 Discord 协议兼容层。服务端 adapter 已拆分到 private repository [`changx/hermes-app-plugin`](https://github.com/changx/hermes-app-plugin)。

## 当前状态

- P0 与 P1 本地交付已完成。历史验收记录保留在 `docs/p1/`；当前仓库只维护客户端与共享客户端代码，Hermes App plugin 在独立仓库维护。
- 产品核心：Channel 公共上下文、Thread 连续对话、独立于客户端在线状态的异步同步。
- 当前同步只使用 `/v1/live`、轻量目录和存活页面的 HTTP 状态/历史读取。旧事件回放接口（`/v1/events`、`/v1/sync`、`/v1/snapshot`）和客户端 checkpoint 已删除，不保留旧客户端兼容。见 [核心数据流](docs/core-dataflow.md)。
- Hermes 是数据与执行的权威服务端；客户端与通信 adapter 不维护第二套权威业务数据。
- 最终必须交付可安装的独立桌面 App 和手机 App；Web/PWA 只可用于中间验证，不能替代最终交付。

## 文档

- [设计需求](docs/requirements.md)：已确认目标、功能需求、建议与待决项。
- [存活 session 页面](docs/live-session-pages.md)：双端页面所有权、并发订阅、唯一页面、销毁规则与内存释放修复。
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
- 需求来源：Jamie 与 Tuly 的 Discord 设计讨论，线程 `1552884015143583759`。
- 文档建立：2026-09-24（PDT）。
- 当前开发环境与既有验收状态见 [开发环境](docs/dev-environment.md)。仓库建立不代表授权生产发布、签名、notarization、其他 profile 变更或正式 App 发布。

## macOS 构建与 Release

桌面安装包在项目 Mac mini（`ssh macmini`）上构建。GitHub Actions 因账户付款问题无法启动 job，2026-10-09 起改用此方式。

1. 推送与 `apps/desktop/package.json` 版本一致的 tag：

```bash
git tag v0.1.58
git push origin main v0.1.58
```

2. 在本机仓库根目录运行：

```bash
scripts/macmini-desktop-release.sh v0.1.58
```

脚本把 tag 源码（`git archive`）传到 Mac mini，执行锁定依赖安装、桌面检查、依赖审计、arm64 打包、zip 和 SHA-256 校验，再取回安装包，由本机 `gh` 创建 GitHub Release，上传：

- `Hermes-<version>-macOS-arm64.zip`
- 对应的 `.sha256` 校验文件

加 `--no-publish` 只构建，不发布。同名 Release 已存在时脚本拒绝发布。发布包是未签名、未 notarize 的 Apple Silicon 开发构建，不是 App Store 或公开发行包。

`.github/workflows/desktop-release.yml` 保留为手动运行（workflow_dispatch），不再随 push 触发。

## 下一步

P1 已验收。手机端通过 Expo Go 入口 `exps://agent.tuly.space` 测试，真实模型联调已通过；macOS 桌面已发布未签名的 arm64 开发构建（当前 v0.1.36）。Description 仅全新逻辑会话注入一次、压缩后不补入。独立手机安装包、签名/notarization 与完整真实设备验收仍是后续工作。开发环境当前状态见 [开发环境](docs/dev-environment.md)。
