# 系统通知开发版发布记录

## 发布范围

已将 `jamie/system-notices` 的实现提交 `edc541ed80235bb08b611fb4dae825e0f9ab0065` 纯快进合入 `main`，并发布到既有 Hermes App 开发环境：

- Hermes App plugin：`hermes-app-dev` profile。
- 手机测试入口：`exps://agent.tuly.space`。
- 只重启 `hermes-gateway-hermes-app-dev.service` 与 `hermes-app-expo.service`。
- Jamie Gateway、固定 Hermes Core、dev profile 配置未改动。

本版把 Hermes 记忆/Skill 自检与 context compression 生命周期作为持久、紧凑的 `system_notice` 投影到对应 Thread。它们不写模型 SessionDB，也不作为 Hermes assistant 回复。压缩同一次尝试原位更新；失败后重试使用新身份。

## 发布与回滚

- 发布实现提交：`edc541ed80235bb08b611fb4dae825e0f9ab0065`。
- 发布记录提交：见本文件所在提交。
- 回滚分支：`rollback/system-notices-before-b0b78e4`，指向 `b0b78e4c9f86d79f767816f337827c6c5ffc73d9`。
- 插件 artifact SHA-256：`e5df7c44ec4dc58cbcceb1f4c5795ee3af0e992245b3a20ff924f887f3f09b91`。
- 私有证据、发布脚本、插件备份及迁移前 SQLite 备份：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/20260928-214015-system-notices/`。

插件使用完整 allowlist artifact 原子替换，安装后逐文件哈希与 artifact 及仓库源码一致。schema 激活前保存了停止 Gateway 后的 SQLite 连贯备份；没有覆盖发布后数据。

## 验证结果

发布前活动 receipt 为 0。发布后已验证：

- 公网 capabilities 与 snapshot 正常，未认证 capabilities 仍返回 401。
- iOS 与 Android manifest 均为 Expo SDK 57、账号 `jamsben`；实际 launch bundle 已换新并包含系统通知协议、校验与 UI 标记。
- 真实 Gateway 延迟自检回调产生一个 review notice；compression start、heartbeat、complete 产生并更新另一个稳定 notice。
- 公网 API 两次冷读完全一致；精确 ref、搜索和 4 个持久 message sync event 均正确。
- 验收 Thread 中只有两个 `role:system / display_kind:system_notice` 条目，模型 SessionDB 消息数为 0；测试 Thread 已归档。
- Jamie Gateway PID/启动时间、固定 Core 提交及状态、dev profile 配置哈希保持不变。

第一次真实回调脚本已生成正确通知并完成归档，但清理断言把 API 的整数 `archived=1` 与布尔 `True` 用 `is` 比较，导致脚本退出 1。已回读该 Thread，确认通知、事件、冷读、精确 ref 与 SessionDB 隔离全部正确；随后修正为布尔语义判断并重新完整执行，第二次通过。该失败属于验收脚本类型判断，不是部署或产品故障，证据中同时保留两次记录。

## 未完成项

自动化发布和公网链路验收不等于 iPhone 视觉验收。需要在 Expo Go 完整 Reload 后，确认系统通知的紧凑样式、时间显示和压缩原位更新体验。
