# Expo Go SDK 57 兼容修复

## 原因与范围

Jamie 的 iPhone 实际提示：Expo Go 支持 SDK 57.0.0，项目 SDK 54 不兼容。此前依据文档选用 SDK 54 已不适用于这台设备。以实际设备 runtime 为准，不要求用户安装旧版 Expo Go。

仅升级 apps/mobile 的 Expo、React Native 与兼容依赖，保留共享客户端、认证及同步语义。验证通过后更新原 hermes-app-expo 开发服务；不修改 Hermes 核心、profile、模型或凭据。

## 验收

- Expo SDK 57 与其 bundledNativeModules 推荐依赖一致。
- 移动端逻辑测试、TypeScript、iOS/Android Metro 导出通过。
- 原公网入口的双平台 manifest 返回 exposdk:57.0.0，实际 launchAsset 下载成功。
- 真机打开、原生传输及界面交互仍由 Jamie 复测，不用构建成功代替设备验收。

## 依据

- 用户 iPhone Expo Go 错误截图（2026-09-26）。
- https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/
- https://expo.dev/changelog/sdk-57
- npm registry 已确认存在 expo 57.0.25。

## 执行结果

待安装、测试与入口验证后记录。
