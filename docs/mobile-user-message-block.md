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

## 最新反馈：ChatGPT 式右侧浅灰气泡（已发布测试入口）

卡片 `t_40a8ef02`；分支 `fix/chatgpt-message-style`，基线 `9f644cf`。Jamie 提供截图并确认以下手机样式。此决定替代上文用户消息满宽浅蓝块及名字起点规则；本轮不修改桌面。

- 所有普通聊天消息隐藏发送者名字；保留原消息时间，Agent 续段仍不重复时间。
- 用户消息整体靠右；气泡最大宽度为消息区扣除两侧各 14pt 后可用宽度的 60%。
- 短消息按内容收窄；长消息在上限内换行。宽高不固定，不测字后强制设宽高。
- 用户气泡使用 `#f3f3f3` 浅灰底、22pt 圆角、左右 14pt 和上下 13pt 内边距；正文左对齐。
- 保留原文、Markdown、附件、发送中颜色、reaction、失败消息操作及滚屏/键盘逻辑。Agent 最终回复背景维持既有样式。
- Markdown 列表正文改用 `flexGrow: 1`、`flexShrink: 1`、`flexBasis: 'auto'`，避免旧 `flex: 1` 的零基准干扰自适应气泡内在宽度与换行高度。

验证：修改前的新组件断言失败，修改后通过；手机全测 **502 passed / 0 failed / 1 skipped**，TypeScript 通过。iOS/Android Expo JS 导出成功，并回读实际 bundle 确认 60% 上限、靠右、浅灰圆角、无发送者和列表 auto 基准。

安装版本 React Native Yoga（Fabric errata=All、像素倍率 3）配合实时 macOS AppKit 原生文字测量：短文、真实长列表原文和嵌套长列表在 320/390/440/768pt、字号倍率 1/1.1/1.3 的 **36/36** 组合中通过宽度上限、右边对齐、无明显子层溢出及下一条消息不重叠检查；短文确实窄于上限。此实验不等于 iOS UIKit 或 iPhone 视觉验收。

隔离环境首次检查缺少生成 Markdown 渲染器与 SDK dist；复用既有渲染器，安装隔离根锁定依赖并构建 SDK 后通过。导出临时增加链接依赖可见目录，检查后恢复 Metro 配置。首次并行双平台导出得到不含本次代码的 Android 产物，已弃用；独立清缓存重导 Android 并核对精确模块后通过。未改锁文件或运行目录。

候选阶段证据：active profile 私有 `workspace/chatgpt-message-style/`。当时未合并或发布；随后发布见下节。导出不是独立安装包。iPhone 视觉、键盘及长内容操作仍待真机验收。

### 授权合并与发布

Jamie 随后授权两端全部提交主分支并发布。手机合并 `2883bdb`，桌面合并 `8138302`，发布代码 `986bbcb72c3a95ad49ed12c419bdd0c75e93be8a` 已推送 main；同时保留 main 中既有存活 session 页面改动。仅需求文案产生冲突，按两端最新样式决定合并。

- 沿用候选全测；由于手机候选与 main 的页面保留改动交叉，补做移动端 TypeScript、74/74 定向集成检查及顺序 iOS/Android 导出，均通过。桌面代码与已通过 120/120 的候选一致，不在本地重复全测。
- 手机入口保持 `exps://agent.tuly.space`。只重启用户级 `hermes-app-expo.service`，PID `2919785` → `3172610`，启动时间 `2026-10-03 08:14:15 PDT`。运行目录是 main 对应的 `apps/mobile`。
- 公网 iOS/Android manifest 与各自精确 launchAsset 均 HTTP 200，SDK `57.0.0`。两个真实 bundle 均确认靠右、60% 上限、浅灰圆角、自动宽高、无发送者名字、左对齐及列表 auto 基准，并保留存活页面导航。
- 两个 Gateway 的 PID/启动时间和开发插件文件哈希前后不变。移动端 lockfile 不变；根 lockfile 只随 Desktop `0.1.14` 更新版本元数据，不安装手机依赖或改依赖图。
- 首次重启后回读暂时返回 502；重试后资源检查通过。另一检查曾引用不存在的诊断标记，改为已读取源码中的真实导航标记后通过，没有为检查改产品代码。

发布卡 `t_1a24c734`；私有证据 active profile `workspace/chatgpt-style-release/`，包含前后服务/插件快照、精确 manifest/bundle、集成与导出记录。此发布仍是 Expo Go 测试部署，不是独立手机安装包。iPhone 视觉、键盘和长内容操作继续单列真机验收。

手机样式回滚使用 `git revert -m 1 2883bdb`，推送 main 并仅重启 Expo，保留其他 main 改动和聊天数据。两端样式回滚依次撤销桌面 `8138302` 和手机 `2883bdb` 的合并（均用 `-m 1`）；桌面可重装完整 `v0.1.13` 包。不 reset 或覆盖权威存储。

## 此前样式反馈：背景铺至两侧、统一名字起点（历史候选）

用户消息及名字规则已被上节最新反馈替代；以下保留当时验证记录。

卡片 `t_759855ad`；分支 `fix/mobile-message-edge-to-edge`，基线 `11a9336`。Jamie 的截图反馈替代上文保留外侧 14pt 边距的决定：黄色最终回复和蓝色用户消息背景铺至消息区左右两端；取消最终回复的左侧装饰边框；名字及正文与普通 Agent 消息统一在左侧 14pt 起点。文字不贴屏幕边缘。纵向间距、颜色、消息身份、reaction、附件、失败消息操作及滚屏逻辑不变。

候选只修改 `ChatTimeline` 三个样式及组件回归。新增断言在修改前失败、修改后通过；定向组件/Markdown/删除失败消息/历史布局测试 **62 passed / 0 failed**，移动端 TypeScript 通过，iOS/Android Expo 导出成功，两个实际 JS bundle 均回读确认零外侧边距、14pt 内边距及无左侧边框。Metro 的临时依赖可见路径已恢复，不改锁文件。

证据：active profile 私有 `workspace/mobile-message-edge-to-edge/`。未合并运行目录、未发布、未重启服务；iPhone 视觉和键盘仍待真机检查。上述导出不是独立安装包。

## 最新补充：隐藏 Agent 回复时间（隔离候选）

Jamie 请求手机与桌面均去掉 Agent 回复上的时间。此规则只替代上文保留 Agent 回复时间的决定；用户消息和系统通知时间保持不变。普通说明、工具记录、最终及直接回复均不显示时间，也不留空标题。存储时间、消息身份、顺序及历史投影不变。

卡片 `t_626cc866`；分支 `fix/hide-agent-timestamps`，基线 `559ca04`。手机 TypeScript 与 **506/506** 测试通过，桌面 TypeScript/构建及真实 Chromium **120/120** 测试通过，均无失败或跳过。新增组件断言在修改前失败、修改后通过，并覆盖冷历史及系统通知。顺序 iOS/Android 导出及精确 bundle 时间显示条件回读通过。

证据：active profile 私有 `workspace/hide-agent-timestamps/`。未合并主分支、未发布或重启服务，未改锁文件、插件、共享协议或 Hermes 核心。导出不是独立安装包；真机视觉仍待检查。

## 最新补充：Working / Worked 图标字体箭头（隔离候选）

Jamie 要求 `Working` 和 `Worked for …` 右侧箭头采用 icon font。手机与桌面共用本地 `assets/work-icons.ttf`，展开显示向下 chevron，折叠显示向右 chevron。只含两个原创图形，字体 1212 字节；无需远程字体。字体生成脚本为 `scripts/build-work-icons.py`，使用 fontTools 4.66.1。手机通过 Expo Go 已有的 `expo-font` 加载，新增直接依赖声明固定为既有 57.0.4，没有新增或升级传递依赖。加载期间或失败时保留固定图标位置，不以普通文字字体显示缺字框；按钮仍可操作。图标不参与辅助功能朗读，按钮原有名称及展开状态不变。

候选继续 `fix/absolute-message-time`，保留用户绝对时间提交 `a4a07ba`；本轮卡片 `t_ce82e157`。手机 TypeScript 及 **509 passed / 0 failed / 1 skipped**（510 个测试，既有可选 Chromium 检查跳过）通过；桌面 TypeScript、构建及实际 Chromium **124/124** 通过。浏览器确认图标字体实际 loaded，并检查 Working 展开、Worked 完成折叠及重新展开时的字形。双平台顺序导出通过，精确 JS bundle 接线及导出的字体字节均与源字体核对一致；桌面构建字体也一致。

首次手机全测与 SDK 构建并行造成 dist 尚未就绪，构建后重跑通过。桌面增加字体文件后更新构建文件白名单；异步字体加载后清理测试脚本，避免 Chromium DOM 输出超过缓冲区。导出临时 Metro 配置已恢复。私有证据在 active Channel workspace 的 `work-icons-*.log` 和 `work-icons-assets.json`。未合并 main、推送、发布或重启服务。Expo 导出不是独立安装包；原生字体显示与按钮手感仍待真机验收。

## 最新补充：用户消息显示日期与时间（隔离候选）

Jamie 要求自己的消息显示日期和时间，不使用 `8h ago` 等相对时间。手机与桌面用户消息统一显示设备本地 `YYYY-MM-DD HH:mm`，精度为分钟。Agent 时间继续隐藏；系统通知、会话目录时间及存储时间、排序、身份、发送队列不变。手机用户时间不启动定时器；权威时间到达后直接更新。

卡片 `t_b74fea04`；分支 `fix/absolute-message-time`，基线 `3a061fd`。手机全测 **507 passed / 0 failed / 1 skipped**（508 个测试，既有可选 Chromium 检查跳过）；新增接线断言后的定向检查 **30/30**。桌面 TypeScript、构建及实际 Chromium 全测 **124/124**；手机 TypeScript 通过。iOS/Android 顺序导出通过，精确 JS bundle 均回读确认用户消息 `absolute` 接线及完整日期格式。未知手机时间显示 `—`，不编造发送时间；epoch zero 保留。

隔离环境补齐根锁定依赖，未改锁文件。导出临时扩大 Metro 链接依赖可见范围，检查后恢复配置。证据在 active Channel workspace 的 `absolute-message-time-*.log`。未合并 main、推送、发布或重启服务；导出不是独立安装包。原生视觉及日期标题在窄气泡中的换行仍待真机验收。

## 最新补充：80% 宽度与可折叠过程（隔离候选）

用户消息上限改为 80%，其余靠右、左对齐正文、浅灰底、宽高自适应不变。公开过程标题运行时显示 `Working`；明确最终回复到达后立即折叠，显示 `Worked for {时间长度}`，点标题可重新展开。标题下有分隔线。用户追加、系统通知和最终正文不隐藏；Agent 时间继续隐藏，消息根节点、身份及顺序保留。

当前耗时是当前已加载首条公开过程记录到明确最终回复的时间差，不是完整服务端执行耗时；缺时间或倒序显示 `Worked for —`，无最终标记且未运行显示 `Work recorded`。不读内部推理，不补造缺失历史，不扩展现有历史加载窗口。实现及完整边界见 [桌面与手机可折叠过程](desktop-session-composer.md#latest-follow-up-80-user-width-and-collapsible-public-work-isolated-candidate)。

分支 `fix/collapsible-work`，卡 `t_5a04dba0`，基线 `f748cc9`。双端与共享 TypeScript 通过，手机 **507/507**、桌面构建及 Chromium **124/124** 测试通过，均无跳过。历史加载测试已修正新增标题后的根节点选择，并验证原消息节点在 prepend 时保留。顺序 iOS/Android 清缓存导出通过，实际 HBC 文件回读确认新宽度与过程呈现字符串。证据：active Channel workspace `collapsible-work/`。

候选阶段未合并主分支、推送或发布，未重启服务。用户随后已授权发布：两轮修改以 `abb2faf` 合入并推送 main，桌面 v0.1.15 已发布，手机 `exps://agent.tuly.space` 已更新。iOS/Android 公网 manifest 及确切 JS launchAsset 均 HTTP 200，确认 80% 宽度、过程折叠、分隔线及隐藏 Agent 时间。仅 Expo 重启，Gateway/插件及手机锁文件不变；根/桌面版本元数据升级，不改依赖图。完整证据与下载核验见 [发布记录](desktop-session-composer.md#published-desktop-v0115-and-mobile-test-entry)。原生视觉、滚动、键盘与辅助功能仍待真机验收，Expo Go 不等于独立安装包。
