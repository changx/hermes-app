# Hermes App · Expo 手机开发版

原生 iOS/Android Expo Go 应用（非 Web/PWA）。使用仓库的 `packages/client/src/index.ts` 作为唯一同步/收据客户端，手机层仅负责 UI、Bearer 头传输和本机凭据/最后一条发送记录。未内置令牌或模型名称。

## 运行与检查

```sh
cd /opt/projects/jamie/hermes-app/apps/mobile
npm ci
npm test
npm run check
npm run export:android
npm run export:ios
# 本地启动；已运行的公网测试实例由 systemd 管理，不重复启动：
npx expo start --host localhost
```

Expo SDK **58.0.22** / RN 0.88.1 / React 19.3.0。按 Jamie 的 iPhone 实际 Expo Go SDK 58 runtime 对齐；新版 Expo Go 只支持 SDK 58。依赖版本与 SDK 58 `bundledNativeModules` 一致，Expo Doctor 20 项通过。升级记录见 [SDK 58 兼容升级](../../docs/expo-sdk58-upgrade.md)。

打开 App 后填 HTTPS 服务源（默认 `https://agent.tuly.space`）及个人令牌。令牌只存在本机 SecureStore，HTTP 和原生 RN WebSocket 升级都用 `Authorization` 请求头；不放入 URL、包或日志。改连接时最后发送记录按连接 ID 隔离；清除连接会删除本机连接和发送记录，不会停止服务端执行。

当前测试链接：`exps://agent.tuly.space`，使用匹配 SDK 58 的 Expo Go 打开。已通过公网 manifest 与双平台 bundle 读取验证，尚待真机验收。服务器上的 `hermes-app-expo.service` 提供开发包，运行细节见 `../../docs/p2-mobile-dev.md`。更换服务器必须重新输入该服务器令牌，不会沿用旧源凭据。

## 当前可用范围

- Channel 列表/创建（含说明）、Thread 列表/创建；原始历史逐页读取，增量事件由共享客户端从持久游标补齐。
- 新消息先把客户端 ID、Thread 与原文写入 SecureStore，再调用共享客户端 `send`；收据与执行状态可查看。网络结果不明时只允许**原 ID、原文、原 Thread**重试；另发一条才生成新 ID。显式放弃旧重试权不会取消服务端可能已接收的执行。
- 展示待审批/澄清选择、停止当前执行与取消排队；退后台关闭 socket（不停止服务端任务），前台补齐并重连；游标异常可手动重建同步。

B3 消息渲染组件位于 `src/MessageContent.tsx`，由聊天列表集成方使用 `<MessageContent text={item.text} />`。`markdown-it` 仅解析 Markdown，不输出 HTML；组件用原生 RN 文本/视图显示标题、列表、引用、强调、代码和显式网页链接。链接仅允许不含用户信息的 HTTP(S) 地址，图片只显示文字标签（不会自动请求远端图像），复制消息/代码使用 SDK 57 对齐的 `expo-clipboard`。代码可横向滚动；未闭合代码围栏按代码显示。此组件独立提供，需聊天列表集成后才出现在应用屏幕上。

开发版限制：未在真机或模拟器验证、未生成 APK/IPA、未集成推送/附件上传下载/搜索/Channel 编辑/未读通知；离线历史不缓存，最后发送记录仅一条，SecureStore 存储过大的正文可能拒绝发送（不会在未保存 ID 前提交）。收据和历史以服务端为准。公开 Expo 测试链接及 Metro HTTPS 由集成方单独设置；此目录不启动公网服务。`expo export` 是 Metro JS 打包证明，**不是**可安装包或设备验收。
