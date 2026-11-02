# 客户端错误日志

## 目的

手机 App 在 Expo Go 中以 `--no-dev` 运行，设备端的 JS 错误不会回传到 Expo 服务日志。客户端错误日志把错误报告发到当前连接的 Hermes，供开发排查。用户界面不显示这些报告。

## 行为

- 插件 0.2.52 提供 `POST /v1/client-logs`（需要认证），capability `client_logs: true`。
- 每条报告写成一行 JSON，保存在该 profile 的 `hermes-app/client-logs.jsonl`。文件权限 0600，上限 4 MiB，超过后轮换一次为 `.1`。每分钟最多 60 条。
- 字段：`kind`（`error`、`fatal`、`unhandled_rejection`、`render`、`console`）、`message`、`stack`、`component_stack`、`route`、`platform`、`os_version`、`app_version`、`runtime_version`、`client_time`、`fatal`。服务端加 `received_at` 和 `auth_kind`。过长字段被截断。
- 手机端（`apps/mobile/src/clientLogs.ts`）捕获全局未处理错误和未处理的 Promise rejection。Session 页面用 `PageErrorBoundary` 捕获渲染错误，页面显示 “This conversation could not be shown.” 和 “Try again”。
- 未发送的报告保存在设备文件 `hermes-client-logs.json`（最多 20 条），所以致命崩溃在下次启动时发送。报告发给第一个成功接收的连接。

## 查看

```bash
tail -n 20 ~/.hermes/profiles/<profile>/hermes-app/client-logs.jsonl
```

Jamie 手机的连接决定报告写入哪个 profile（例如 `jamie` 或 `hermes-app-dev`）。

## 同次修复

SDK 58 把 `File.copy()` 改为异步。`localDraftStorage.ts` 恢复和保存草稿附件时改用 `copySync()`。

## 发布记录（2026-11-01）

- 插件仓库 `main` `d1b1cd0`，0.2.52 解压到 `plugin-releases/hermes-app/releases/0.2.52`，与源码一致；`current` 0.2.51 → 0.2.52。Gateway 未重启（PID 3302268），待 Jamie 重启。
- App `main` `818a47d`（含 `c8857bc` copySync 修复），只重启 `hermes-app-expo.service`（PID 3320064 → 3558386）。公网 iOS / Android manifest 与 launchAsset 均 HTTP 200，SDK 58，bundle 含 `/v1/client-logs`。
- 测试：插件新测试 4 项通过；P1 全量失败集合与 main 相同（main 既有 32 项失败，`test_real_runner_loopback` 在两边都偶发失败）。手机端 TypeScript 通过，测试 240 通过、0 失败、1 跳过；共享客户端 105 通过；iOS/Android 导出通过。
- 回滚：`current` 指回 `releases/0.2.51` 并重启 Gateway；App `git revert` 后重启 Expo。
