# Hermes App · Expo 手机开发版

原生 iOS/Android Expo Go 应用（非 Web/PWA）。使用仓库的 `packages/client/src/index.ts` 作为唯一同步/收据客户端，手机层仅负责 UI、Bearer 头传输和本机凭据/最后一条发送记录。未内置令牌或模型名称。

## 运行与检查

```sh
cd /opt/projects/jamie/_worktrees/hermes-app/p2-expo-first/apps/mobile
npm ci
npm test
npm run check
npm run export:android
npm run export:ios
# 仅在获准的私有开发网络上，由负责 Metro 的人员启动：
npx expo start --host localhost
```

Expo SDK **54.0.37** / RN 0.81.5 / React 19.1.0。选择 54 而非 npm 最新的 57：截至当前 Expo 官方兼容说明，App Store 的 iOS Expo Go 停在 SDK 54；SDK 55+ 不能用 App Store 的实体 iPhone Expo Go。Android 需安装 SDK 54 匹配版本（expo.dev/go）。SecureStore、Crypto、safe-area 模块由 `npx expo install ... --npm` 选定兼容版本。参考：https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/ 。

打开 App 后填 HTTPS 服务源（默认 `https://agent.tuly.space`）及个人令牌。令牌只存在本机 SecureStore，HTTP 和原生 RN WebSocket 升级都用 `Authorization` 请求头；不放入 URL、包或日志。改连接时最后发送记录按连接 ID 隔离；清除连接会删除本机连接和发送记录，不会停止服务端执行。

## 当前可用范围

- Channel 列表/创建（含说明）、Thread 列表/创建；原始历史逐页读取，增量事件由共享客户端从持久游标补齐。
- 新消息先把客户端 ID、Thread 与原文写入 SecureStore，再调用共享客户端 `send`；收据与执行状态可查看。网络结果不明时只允许**原 ID、原文、原 Thread**重试；另发一条才生成新 ID。显式放弃旧重试权不会取消服务端可能已接收的执行。
- 展示待审批/澄清选择、停止当前执行与取消排队；退后台关闭 socket（不停止服务端任务），前台补齐并重连；游标异常可手动重建同步。

开发版限制：未在真机或模拟器验证、未生成 APK/IPA、未集成推送/附件上传下载/搜索/Channel 编辑/未读通知；离线历史不缓存，最后发送记录仅一条，SecureStore 存储过大的正文可能拒绝发送（不会在未保存 ID 前提交）。收据和历史以服务端为准。公开 Expo 测试链接及 Metro HTTPS 由集成方单独设置；此目录不启动公网服务。`expo export` 是 Metro JS 打包证明，**不是**可安装包或设备验收。
