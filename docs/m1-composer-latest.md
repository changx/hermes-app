# 聊天底部留白与返回最新位置

## 已确认需求

- 聊天列表原有底部 padding 48pt 加倍为 96pt。
- 返回最新按钮位于输入区域上方靠右，随输入区移动，不占输入行宽度。

## 实现

`apps/mobile/src/ChatTimeline.tsx` 只调整底部留白与按钮容器。按钮移入现有 KeyboardStickyView 顶部的右对齐行，附件面板、审批控件、运行提示与输入区仍由同一键盘容器移动。沿用原有显隐、点击恢复跟随、键盘运动时延后滚动及阅读锚点逻辑；不用独立键盘偏移、定时器或消息遮罩。

## 验证

- 定向组件与键盘回归 39/39，通过真实组件 mock 检查普通/附件输入区的按钮归属、靠右排列、显隐与点击、阅读时 dock 高度变化不强制滚动，以及键盘运动时延后恢复跟随。
- 全量手机测试串行运行 278/278 通过。此前默认并行运行 277/278，outbox 的 cleanup 重试测试出现 `1 !== 0`；未定位该失败原因，不宣称默认并行全量通过。初次独立工作树测试缺 SDK dist，构建 SDK 后已解决。
- TypeScript 检查与 iOS/Android Metro export 通过。
- 验证日志位于私有 `/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/composer-latest/`。
- 候选验证时未发布；后续授权发布结果见下节。真机键盘交互与视觉验收未完成，组件测试/Metro 导出不代替真机结果。

## 授权发布

Jamie 明确要求“发布”后，`15c2c8f495d8bd1a411cd2f2a4412d5f3949389a` 已 fast-forward 至运行目录，更新既有 `exps://agent.tuly.space` 手机开发入口，仅重启 `hermes-app-expo.service`。

- 公网 iOS/Android manifest 与各自精确 launchAsset 均读取成功；实际资源确认 96pt 底部留白和最新按钮的独立右对齐行。
- 开发与 Jamie Gateway 的 PID、启动时间保持不变，已安装插件文件哈希保持不变。
- 发布启动时一次公网探测返回 502，curl 自动重试后恢复；首次资源断言未兼容 bundle 的换行空白，修正验证脚本后双平台验证通过，未修改应用实现。
- 验证脚本、manifest、资源哈希和发布前状态保留于上述私有日志目录。回滚基线 `4aa3293` 保留在 Git；需要回滚时创建明确回滚提交，不覆盖用户数据。
- 尚未做真机视觉及键盘手势验收。

卡片：`t_774c8f06`。
