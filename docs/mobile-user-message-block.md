# Mobile 用户消息：满宽浅蓝 block

卡片：`default / t_ee1ce0b2`。隔离分支：`fix/mobile-user-message-block`，开发基线 `5a6f70a`。

## 已确认决定

Jamie 在长列表穿出蓝气泡并与下一条回复重叠的反馈中确认：去掉用户消息气泡，整块 block 使用原气泡底色。

- 所有用户消息使用消息区可用满宽的浅蓝 block，底色仍为 `#e6f0ff`。
- 去掉用户消息外层边框、圆角、80% 上限和按内容自适应的气泡宽度；不继承通用 `bubble` 样式。
- 外层消息行保留左右各 14pt 边距；block 保留 13pt 正文内边距及原纵向间距。
- 普通短文、长文、列表、代码、表格和媒体使用同一个确定宽度的容器，不再按 Markdown 类型切换视口宽度。
- byline、原文、发送中颜色、reaction、附件和 Markdown 内部语义样式不变；Agent 正文和最终回复样式不变。
- 本决定替代此前移动端“短文自适应、80%上限”的用户消息外层规则；旧文档中相关段落仅为历史记录。

## 原因与验证边界

从真实 `MessageRow` 和 `MessageContent` 导出组件树，并编译项目安装的 React Native Yoga 源码，按 Fabric 的 `YGErrataAll` 和像素倍率 3 执行。文字通过 Mac mini 的原生 AppKit `NSTextStorage` / `NSLayoutManager` 实际测量，不使用模拟字宽。

旧布局的列表正文 `flex:1` 与自适应用户气泡组合，使气泡的内在宽度主要取决于前面的短段落。长列表先在较宽约束下测高，最终气泡收窄后列表重新换行，外层保留先前高度，子层溢出；不需要 FlashList 即可复现。Yoga `processFlexBasis` 的源码也确认，非 Web 默认下正数 `flex` 会采用 0 基准，不能把 `flex:1` 当成只设置 `flexGrow:1`。

先前使用独立 Yoga 3.2.1 和模拟文字测量得到的“零宽”解释已撤回：安装版本和 Fabric 实际配置的原生文字实验没有零宽测量，仍能复现宽高不一致。这里不将 macOS TextKit 冒充 iOS UIKit 或真机截图。

## 实现与自动检查

- 用户外层直接使用 `userMessageBlock`；删除其原 `own` / `ownViewport` 及不再需要的 Markdown 视口分类接线。
- 更新生产组件样式回归，增加短文、长文、长列表、嵌套列表、引用、代码、表格、图表与图片的统一容器检查。
- 修改前的新增样式断言确实失败，修改后通过。
- 安装版本 Yoga + Apple 原生文字测量：候选长列表在 320/390/440/768pt 及字号倍率 1/1.1/1.3 的 **12/12** 组合中满宽、无显著父子溢出，reaction 和下一条消息位于正文之后。
- 手机全测：**430 passed / 0 failed / 1 skipped**（431 个测试；既有可选 Chromium 检查跳过）。TypeScript 通过。
- iOS / Android Expo JS 导出通过；两个实际 bundle 均回读确认 `userMessageBlock` 满宽浅蓝样式，且没有继承外框、圆角或最大宽度。
- `git diff --check` 通过。

隔离工作区复用锁定依赖；首次全测缺少本工作区 SDK dist，构建现有 SDK 后重跑通过。首次导出受到跨 worktree 依赖／生成文件链接不可见影响；临时扩展隔离 Metro 的依赖可见范围、复制既有生成渲染器后双平台导出通过。临时 Metro 配置已恢复，不提交环境专用路径，不修改锁文件或运行目录。

## 交付状态

初始实现为隔离候选。Jamie 随后明确授权提交、合并与发布；客户端提交 `ac6d11f524cfe4c158f9efb32d217d9354253239` 已从基线 `5a6f70a` 快进到 main 并推送，随后只重启 `hermes-app-expo.service`。

- 手机入口保持 `exps://agent.tuly.space`，这是 Expo Go 测试部署，不是独立安装包或正式发行。
- 公网 iOS / Android manifest 及各自精确 launchAsset 都返回 HTTP 200，SDK `57.0.0`、runtime `exposdk:57.0.0`；实际服务代码确认满宽浅蓝 `userMessageBlock`、无气泡外框/圆角/80%限制，并保留 Channel Context 和首条消息输入栏。
- 两个 Gateway 的 PID/启动时间、已安装开发插件文件哈希、根与移动端锁文件哈希前后不变；未改桌面、共享协议、插件、Hermes 核心、其他 profile 或签名/商店配置。
- 发布阶段沿用候选已经通过的全测、TypeScript 和双平台导出，不重复安装依赖或跑全套测试。

发布卡：`default / t_fc44e9d6`。精确资源回读和服务/哈希快照：私有 `workspace/mobile-user-message-block/release/`。

回滚：`git revert ac6d11f`，推送 main，并仅重启 Expo；基线为 `5a6f70a`。不 reset 或覆盖聊天数据。

证据：active profile 私有 `workspace/mobile-user-message-block/`（测试、类型检查、双平台导出及 bundle 标记、baseline/candidate 原生布局结果）。

iPhone 上同一长列表的背景包含关系、纵向滚动、键盘开关与重新进入会话仍需真实设备验收；不因上述检查通过而提前关闭真机验收。
