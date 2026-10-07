# 开发实例 LCM 修复

## LCM 运行版本更新（2026-10-06 核实）

`19845a7` 的激活状态已过时。开发 Gateway 已于 2026-10-05 20:43 PDT 重启，当前运行 `hermes-lcm` 分支 `jamie/app-dev-threshold-only`、提交 `17ac4ea`（v1.0.0-rc.1 之后的 `6a688ba` threshold-only 摘要与 `17ac4ea` recall policy skill）。它不包含下文的 `19845a7` 回移提交。下文只作为历史记录；当前配置以 `lcm_status` 实际返回为准。

## 历史状态：已安装，等待外部激活

按 Jamie 请求，将主实例验证过的 LCM 修复回移到 `hermes-app-dev`。只修改开发 profile 的 LCM 插件与相关压缩配置；不升级固定 Hermes 核心、不修改 App 插件/客户端、不重启 Expo 或 Jamie 主实例。

- 开发上游基线：`49e99a272d2d461e5c90732e7ef2bc20e96f0826`（0.20.0）。
- 已安装回移提交：`19845a77c7cd1ae0ba3f8b04492abea57b0087b7`，分支 `jamie/app-dev-threshold-full-source`。
- 来源修复：Jamie `33fc55ebafca060dcd2a801dd91a748f2adc6329` 和 `2dc6d8e9a4c865f488447b30f80fff7b4d596ee9`。没有整包升级到 Jamie 上游 RC 基线。
- 实际目录：`/home/hermes/.hermes/profiles/hermes-app-dev/plugins/hermes-lcm`。

自动摘要服从完整请求阈值；阈值下仅做必要的确定性清理，metadata 重建不触发摘要。保留手动强制和真实 overflow。摘要使用经过既有清理/脱敏的完整正文；只展开本会话的合法历史工具引用，预算按实际展开后的证据大小计算。

相关配置与已验证方案对齐：threshold 0.80，fresh tail 24 条/24k，leaf 8k；两个 opt-in 开关开启，新工具外置/active replay stubbing/transcript GC/deferred maintenance 关闭；idle 为 0、Codex native 关闭，仅摘要 reasoning effort 为 low。主模型、认证与其他辅助设置保持不变。

## 实际验证

- 固定开发 Hermes host + 干净隔离环境：1235 项相关回归通过，包含 engine/core/tool 契约、payload 保护、历史外置回滚及新修复测试。
- 9 种 metadata/tool/SessionDB/Gateway 重载路径：低阈值摘要调用 0、网络调用 0，临时数据库已清理。
- 已安装代码的新进程探针：两个开关 true，272000 窗口对应 217600 阈值。
- 现有 6405 条核心消息的 ID、session、role、正文与工具字段整体指纹与备份一致。
- 公网和本机 capabilities 返回 200；dev、Jamie、Expo 的 PID 与启动时间均保持不变。
- 全测试集扩大运行超时，不能声称全套通过。继承 live LCM 环境曾造成测试路径污染，相关失败在旧基线亦复现；清除环境后相关 1235 项通过。仅删除了经 fixture 原文、时间与无真实 DB 引用验证的 3 个测试 payload；没有删除真实历史。

## 激活与待验收

当前 Gateway 仍在运行旧代码。会话内直接重启被 Gateway 安全 guard 拦截，未绕过。外部终端先确认开发执行空闲，再执行：

```bash
systemctl --user restart hermes-gateway-hermes-app-dev.service
```

随后核验开发服务健康，经真实 App Thread 调用 `lcm_status`，确认实际路径/提交、两个开关和模型窗口/阈值；验证新消息入 LCM、旧历史冷读不变。此运行时验收尚未执行，不关闭任务。

## 恢复与证据

私有证据：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/lcm-fix/`。保留 `deployment.json`、`staged-verification.json`、测试日志、脚本与 `rollback/`。回滚包括原 config/env、Git bundle 和通过 quick_check 的 state.db/lcm.db 在线备份。正常代码/配置回滚不要恢复数据库；恢复 DB 会覆盖之后历史，必须另获授权。

隔离 LCM 工作树和自建测试目录已清理，源分支与备份保留。未推送或发布客户端。
