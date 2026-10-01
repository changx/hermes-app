# 历史关联执行状态：开发发布记录

## 当前状态

Jamie 已授权两仓库合入主分支并发布既有开发入口。

- 客户端功能提交 `1a30928`，与当时最新 main `54b20a3` 合并后的发布代码 `794b511`；已推送客户端仓库 main。
- 插件功能提交 `587a90f`；已快进独立插件仓库对应 mainline 并推送远端 main。
- 已校验插件 artifact，安装到 `hermes-app-dev`，全部 allowlist 文件与主分支源码逐文件哈希一致；实际唯一变化为 `storage.py`。
- 已重启 `hermes-app-expo.service`，客户端 bundle 已发布到 `exps://agent.tuly.space`。
- **开发 Gateway 重启被会话内安全 guard 拦截，没有绕过。新服务端历史 receipts 返回尚未激活，本轮完整发布尚未完成。** 客户端保留旧后端有界补读兼容，因此当前仍使用旧读取路径。

## 验证

- 候选原验证：264 插件测试、77 SDK 测试、361 手机测试与 TypeScript、双平台导出通过。
- 与最新客户端 main 集成后：收据/历史布局定向测试、手机 TypeScript、iOS/Android 导出通过，无重复安装锁定依赖。
- 公网 iOS 与 Android manifest 及各自精确 launchAsset 均 HTTP 200，SDK 57；实际 bundle 含本次 historyReceipts/关联校验代码标记。
- 认证 capabilities、snapshot、历史冷读 HTTP 200，认证 WS hello 通过，既有原始消息身份冷读一致。
- 回读远端两仓库 main SHA 与对应发布代码一致。
- 开发 Gateway PID `2937965` 未变；Jamie 主实例 PID `2607844`、启动时间、固定 Core 与开发 config/env 哈希不变。
- Expo 新 PID `3832331`，启动时间 `2026-10-01 02:51:28 PDT`。

上述结果不等于服务端新路径或 iPhone 验收通过。激活后仍需验证历史同次返回 receipts/版本、同 ID 幂等及至少一条真实模型消息。

## 激活与回滚

在本次会话结束且开发执行空闲后，从 Gateway 之外的独立终端执行：

```bash
systemctl --user restart hermes-gateway-hermes-app-dev.service
```

仅重启开发 Gateway，不操作 Jamie 主实例或其他服务。先前已安装但未加载的 LCM 修复也会随新进程加载；本轮没有进一步修改其代码或配置，其独立运行验收仍需跟踪。

客户端回滚基线：`rollback/history-receipts-before-54b20a3`；插件回滚基线：`rollback/plugin-history-receipts-before-00242e8`。客户端以明确 revert 撤销功能提交 `1a30928`（保留其他 main 历史修正），插件撤销 `587a90f` 后仅重启受影响服务。只回滚源码/插件，不恢复或覆盖聊天数据库。

私有证据、发布前服务状态/哈希、旧插件、SQLite 在线备份、artifact 与两平台资源回读：`/home/hermes/.hermes/profiles/hermes-app-dev/workspace/history-receipt-snapshot/release/`。插件 artifact SHA-256：`2cfa7ab97feb2c212fb9ef42ba687cc0933b5e982feaa33b86197a1d37913eec`。
