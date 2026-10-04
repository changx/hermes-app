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

## 透明面板候选

返回最新所在行显式透明，沿用同一 KeyboardStickyView，并以行的实际测量高度抵消占位，让消息可在透明区域后方滚动；不把按钮移出父级触摸边界。行和 dock 使用 box-none，空白区域不拦截消息手势。按钮底色和点击行为不变，行高适应字体变化，隐藏后取消重叠。

定向组件、滚动、键盘与附件测试 52/52 通过，TypeScript 检查通过。首次类型检查缺少独立工作树的生成渲染器，执行既有 build:markdown-renderer 后通过。候选阶段未发布；卡片 `t_80d8ff5c`。

### 透明面板授权发布

Jamie 再次要求“发布”后，`42a20a9adaf9ff5d0842515db1cd3c17adec2706` 已 fast-forward 至运行目录，并仅重启 Expo。入口仍为 `exps://agent.tuly.space`。

- 公网 iOS/Android manifest 及其精确 launchAsset 验证通过：透明行、按实际行高抵消占位、box-none、行高测量回调及 96pt 留白均在实际资源中。
- 开发与 Jamie Gateway 的 PID/启动时间、已安装插件文件哈希均保持不变。
- Expo 启动期间首次探测返回一次 502，自动重试后双平台成功。
- 发布脚本、发布前状态、manifest 和资源 SHA-256 保存在私有 `/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/latest-panel-transparent/`。回滚基线 `9ba1f15` 保留在 Git；如需回滚使用明确回滚提交。
- 真机视觉、透明区域手势穿透与按钮点击仍未验收；公网资源核验不代替设备测试。

卡片：`t_774c8f06`。

## Session initial tail and six-line composer

候选分支 `fix/session-initial-tail-six-lines`，基线 `33e2975`，卡片 `t_a128128a`。仅修改手机 `ChatTimeline`，不发布、不改桌面、协议、插件或 Hermes 核心。

- 首次普通进入使用 FlashList 的 `startRenderingFromBottom`，配置在组件挂载时固定。保留原有列表锚点机制。
- 第一批非空历史提交后安排无动画到底部，不依赖新消息是 Agent 回复，也不只依赖 content-size 事件。FlashList 首次布局完成的 `onLoad` 再使用现有原生精确到底部函数。
- 附件目标不启用底部初始化。上翻、失焦、后台和键盘的既有保护仍生效；返回存活页面不重新初始化。
- 输入框保留内容驱动的自然高度和空值单行复位。显式平台行高随原有字体包装器缩放；最大高度为六行，包含 App 字号和系统字体倍率。取消原外层 120pt 上限，超过六行后原生输入框内部滚动，不截断文字。

验证：新增真实 React 组件回归 5 项，原生组件边界使用测试替身，覆盖空页到第一批用户历史、onLoad、阅读/覆盖返回、附件目标、恢复阅读位置、四种 App 字号、两种系统倍率、iOS/Android、长文编辑及空值复位。相关定向测试 27/27；完整手机测试 69 通过、1 跳过（既有 Chromium 表格测试未启用），0 失败。TypeScript、iOS/Android Expo 导出与 diff check 通过。准备工作树时先补建既有 Markdown 生成文件；根目录 esbuild 缺可选二进制时使用相同版本的手机依赖二进制，没有改依赖或 lockfile。

当前为隔离候选。没有合入 main、更新 Expo 或重启服务。自动检查证明组件调用和构建结果，不证明 iPhone 的逐帧滚动、原生六行高度或键盘操作体验；这些仍须真机验收。私有证据位于 Channel workspace 的 `session-initial-tail-six-lines/`。
