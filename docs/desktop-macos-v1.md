# macOS 桌面 App 第一版设计

## 已发布：Desktop v0.1.31

右侧附件/生成页面预览、标准 Chrome UA 网页浏览，以及消息/草稿/本地文件小缩略图已合入 main 并随 [v0.1.31](https://github.com/changx/hermes-app/releases/tag/v0.1.31) 发布。同次发布的 Session 代码背景色统一为 `rgb(245,245,250)`。源 tag 为 `13db56f513b5863d436038b34f27eda5423e4552`；桌面集成检查 62/62、共享客户端 16/16 通过，macOS arm64 构建/审计/打包通过，下载包 checksum、ZIP CRC、架构、版本和 ASAR 字节一致性已验证。发布与范围证据见 [集成记录](desktop-session-composer.md#desktop-v0131-integration)。安装包未签名、未公证；macOS 安装版视觉、键盘与 Finder 操作仍待验收。以下候选描述为历史实现和安全边界记录，不代表仍未发布。

## 当前候选：右侧附件预览与浏览器

隔离分支 `feat/desktop-preview-sidebar`，卡 `t_7de73bfe`。附件卡、已上传草稿及 New chat 本地文件提供 **Preview**；tab 栏 **Browser** 打开地址输入。HTTP/HTTPS 消息链接和附件公开链接进入同一右侧浏览器；Session 链接仍沿用原路由。保留 Save 与 Open externally，不自动上传本地预览、不自动发送消息。

- 支持 PNG/JPEG/GIF/WebP、Chromium 内置 PDF 阅读器、文本/JSON/源码，以及可执行 JavaScript 的 HTML 页面。Markdown 当前显示源码，不宣称富文本预览；其他二进制格式明确提示保存或外部打开。
- HTML 页面可使用网页依赖和 HTTP(S)/WebSocket。相对资源仅匹配同一 Session 中唯一同名的图片、CSS、JS、字体附件，最多八个。拒绝目录穿越、任意磁盘邻居和文本/文档附件资源。New chat 本地 HTML 不读取旁边文件；多目录页面需使用自包含 HTML 或网页 URL。单文件最多 10 MiB，单 HTML 上下文累计最多 30 MiB。只保留最近一次附件上下文；较早附件需从卡片重新打开。网页历史支持后退、前进、刷新、停止。
- 每个 tab 按需建立独立 `WebContentsView` 和非持久 browser session。切换 tab 保留页面，隐藏/静音非活动视图；关闭 sidebar、tab、身份或窗口时释放。关闭或网页导航后，迟到的附件响应不能重建 sidebar 或覆盖网页。聊天 DOM、草稿和历史继续由原 tab 持有。
- 右栏宽度为窗口的 42%，限制在 280–560px。窄窗口临时收起左栏；关闭右栏恢复左栏偏好。Workspace 对话框隐藏两侧原生视图；原生 bounds 保持分隔线和聊天/浏览器不重叠。
- 网页没有 Hermes preload、Node、App API 或网关凭据。继续启用 context isolation、sandbox 配置和 web security；主进程下载附件并检查 Thread、身份、可用状态和实际字节长度。文本转义后显示。拒绝设备权限、特权协议导航及隐式下载；只对 Chromium 内置 PDF extension 放行阅读器资源。浏览器 cookie 不共享 App/default session。HTML 仅在用户点击 Preview 后运行，仍应视为不可信网页。
- UA 使用标准 desktop Chrome reduced 格式，主版本取当前 `process.versions.chrome`，其余版本段为 `0.0.0`。macOS 平台段配置为 `Macintosh; Intel Mac OS X 10_15_7`，不包含 Hermes/Electron；session 和 web contents 设置相同 UA。此要求只涉及 UA，不把 Electron 引擎变成 Google Chrome，也不保证反机器人绕过或所有浏览器特性。

验证：desktop 类型检查/构建通过；开启 Chromium headless-shell 和 Linux/Xvfb Electron 后 **54/54** 测试通过、零跳过。共享 client 类型检查/构建及 **16/16** 测试通过。原生测试核对 HTTP/WebSocket 请求 UA 与 `navigator.userAgent`，覆盖 HTML 脚本/相对资源、图片尺寸、PDF 原生插件/阅读器 frame、文本转义、本地草稿预览、真实地址栏、链接/弹窗/历史、cookie/API 隔离、权限/下载拒绝、窄窗口/对话框、迟到响应取消及生命周期。保留 tab 的剪贴板/历史/草稿回归也通过。另一次 opt-in 原生 smoke 实际打开 `https://example.com/` 并读回标题和正文；其余服务端传输/存储使用受控测试数据。

环境边界：普通 Chrome-for-Testing 连最小 `--dump-dom` 都超时；使用 Chromium headless-shell 重跑原断言全部通过，失败与成功日志保留在 channel workspace。Linux 原生测试沿用 Xvfb/`--no-sandbox` 启动方式，不证明 macOS OS sandbox。macOS 已安装 App 的视觉、PDF 操作、焦点及键盘验收仍待进行。候选未合入 main、未发布/安装、未重启服务；不改手机、插件、核心、依赖或签名。

已检查的官方参考：[WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)、[webContents](https://www.electronjs.org/docs/latest/api/web-contents)、[session](https://www.electronjs.org/docs/latest/api/session)、[protocol](https://www.electronjs.org/docs/latest/api/protocol)、[security](https://www.electronjs.org/docs/latest/tutorial/security)、[Chrome UA reduction](https://www.chromium.org/updates/ua-reduction/)。运行行为以原生测试结果为准，不由 API 名称推断。

以下保留早期设计状态记录，不代表当前实现或发布状态：设计方向已确认，实施任务已拆分到 `docs/desktop-kanban.md`；当时仓库已有未验证的 Electron main/preload/build 脚手架，但尚无完成的桌面功能卡。

## 1. 已确认决策

- 第一桌面平台为 **macOS**，优先支持 Apple Silicon。
- 桌面端与手机端是**同一个产品**：连接同一 Hermes App 服务端，使用同一 Channel、Thread、消息、收据、审批、附件、未读和同步语义。
- 桌面端不要求与手机端使用相同页面或导航；桌面采用适合宽屏和键鼠的界面。
- 技术路线沿用既有结论：**Electron + React DOM**。手机继续使用 Expo/React Native。
- 复用现有 Hermes App plugin 和 `packages/client`，不为桌面端修改 Hermes 核心，不建立第二套权威聊天存储。
- 分发、Developer ID 签名、notarization、自动更新和应用商店以后决定，不作为第一轮开发前置条件。

## 2. 第一版目标

第一版应能在一台真实 Mac 上作为日常聊天客户端使用，而不是网页演示或只显示静态数据的桌面壳。

核心闭环：

1. 通过设备配对连接 Hermes App 服务端，并安全保存设备凭据。
2. 查看、创建和编辑 Channel；查看、创建、改名和归档 Thread。
3. 读取最新消息、向上分页、发送消息，并持续接收 Agent 输出。
4. 支持停止、运行中补充内容、排队取消、审批和澄清。
5. 支持 Markdown、代码、表格、Mermaid、工具调用记录和附件。
6. 断网、切网和服务重启后自动恢复；同 ID 重试不重复消息或执行。
7. 与手机端同步未读、已读、消息、执行状态和审批状态。
8. 全部客户端关闭后，服务端已接收的正常任务继续；重开桌面或手机后可恢复结果。

## 3. 信息架构与桌面布局

当前桌面候选使用自建 tab 栏与独立 `WebContentsView`，详见 [桌面标签工作区](desktop-tabs.md)。它取代下方早期三栏/channel-tree 布局和 Title 弹窗。当前 sidebar 直接显示分组 Session，Running 优先；New chat 提供完整正文、附件和 Project 页面，成功后在原 tab 转为 Session 页。下方布局仅保留为早期 V1 设计记录，不作为当前布局验收标准。

主窗口使用三栏结构：

```text
┌──────────────┬──────────────────────┬──────────────────────────────────┐
│ Channels     │ Threads              │ Conversation                     │
│              │                      │                                  │
│ Project A    │ Topic 1        2     │ Thread title          Actions    │
│ Project B    │ Topic 2   Running    │                                  │
│ Project C    │ Topic 3              │ Messages / tools / attachments   │
│              │                      │                                  │
│ + Channel    │ + Topic              │ Composer                         │
└──────────────┴──────────────────────┴──────────────────────────────────┘
```

### 3.1 Channel 栏

- 显示 Channel 列表和当前选中状态。
- 提供新建 Channel 入口。
- Channel 编辑放在面板或对话框中，不挤占主要消息区域。
- Channel Description 默认不作为普通消息显示；可从 Channel 信息入口查看和编辑。
- Description 的模型上下文语义沿用现有服务端规则：仅全新 Thread 初始化时注入一次，既有 Thread 不热更新。

### 3.2 Thread 栏

- 显示当前 Channel 下未归档的 Thread。
- 每项显示标题、最后消息时间、未读数量和真实运行状态。
- 排序与手机端采用同一产品规则，不因桌面缓存产生另一种权威顺序。
- 提供新建 Topic、改名和归档操作。
- 支持键盘选择；第一版不要求复杂分类、标签或论坛视图。

### 3.3 Conversation 区

- 顶部显示 Thread 标题和紧凑操作入口。
- 中部显示连续用户可见时间线。
- 底部固定输入区；审批、澄清和 Agent 运行状态靠近输入区或对应消息显示。
- Agent 消息采用适合阅读的最大宽度，不在超宽窗口中无限拉伸。
- 用户消息、Agent 消息、系统通知和工具记录沿用手机端已经确定的内容表达规则。
- 底部跟随、用户上翻停止跟随、回到最新、加载旧历史保持锚点等行为与手机端语义一致，但使用 DOM/桌面列表实现。

### 3.4 响应式窗口

- 正常宽度显示三栏。
- 中等宽度可收窄或折叠 Channel 栏。
- 很窄窗口可在 Channel/Thread 与 Conversation 之间切换，但不复制手机端导航栈实现。
- 本地保存窗口尺寸和栏宽；这些仅是设备偏好，不进入服务端聊天状态。

## 4. 桌面交互

第一版建议提供：

- `Enter` 发送，`Shift+Enter` 换行。
- `Command+K` 快速切换 Channel/Thread。
- `Command+N` 在当前 Channel 新建 Topic。
- 标准 `Command+C/V/A/F` 行为；搜索范围需在实现卡中明确。
- 从 Finder 拖入文件添加附件。
- 代码块复制按钮。
- 点击附件下载或使用系统默认应用打开。
- 系统通知点击后定位到准确 Thread；通知只作提醒，正文仍从服务端读取。
- 遵循 macOS 减少动态效果、键盘导航和辅助功能设置。

第一版暂不实现多窗口、托盘常驻、全局快捷键或复杂窗口恢复。

## 5. 技术结构

建议新增：

```text
apps/
  mobile/                  # 现有 Expo/React Native App
  desktop/                 # 新 Electron App
    src/main/              # Electron main process
    src/preload/           # 最小白名单 IPC
    src/renderer/          # React DOM UI

packages/
  client/                  # 现有协议、同步及权威投影客户端
  app-state/               # 按实际需要逐步抽取的跨端纯 TS 状态逻辑
  message-model/           # 可选：时间线投影与消息归并
  markdown/                # 可选：解析与安全规则，不强求共享渲染组件
```

目录名称除 `apps/desktop` 外均为建议，不应为了形式先拆出空包。共享逻辑应在桌面真实接入时按明确复用点逐步抽取。

### 5.1 应共享的能力

- `HermesClient` 及协议类型。
- 快照、增量同步、游标恢复和连接状态。
- 稳定消息身份、收据、去重和执行状态归并。
- 时间线投影规则和系统通知规则。
- outbox 的持久发送记录、同 ID 重试和 unknown 处理原则。
- 历史分页、未读和跨设备已读规则。
- Markdown 解析、安全链接和工具显示规则。
- 面向用户的错误分类与文案原则。

### 5.2 不强行共享的能力

- React Native 页面组件、`FlatList` 和 Expo Router 导航。
- 手机键盘、手势、安全区和 AppState 适配。
- Expo SecureStore、相册和文件选择器。
- Electron 窗口、菜单、Keychain、Finder 拖放和通知。
- Mermaid/表格的具体渲染容器；桌面可直接使用受限浏览器环境，不复制手机 WebView 尺寸桥。

目标是共享业务语义和纯 TypeScript 规则，而不是让两端使用同一套视图组件。

### 5.3 React 状态接入

第一版优先为 `HermesClient` 增加薄 React adapter，例如使用 `useSyncExternalStore` 将客户端变更连接到选择器。界面状态单独管理：

- 当前 Channel 和 Thread；
- 各栏宽度和窗口偏好；
- 当前草稿与待上传附件；
- 已加载历史窗口和分页游标；
- 面板、对话框和查看器状态。

不把引入大型状态框架作为首屏开发的前置条件。只有状态传播实际失控时再评估额外 store。

## 6. Electron 安全边界

生产方向从第一天保持以下基线，即使初期只生成内部开发包：

- `nodeIntegration: false`。
- `contextIsolation: true`。
- renderer 使用 Chromium sandbox。
- 启用严格 CSP，消息 HTML 不执行远程脚本，不获得 Node/Electron 权限。
- preload 只暴露明确白名单能力，不提供通用命令执行、任意 IPC 或任意文件读取。
- 外部链接经过协议和目标校验后交给系统浏览器。
- 凭据存入 macOS Keychain，不进入源码、日志、通知正文或 renderer 持久明文存储。
- 文件选择、下载和打开由 main/preload 通过窄接口完成；renderer 不持有无限制本地路径能力。
- 本地缓存和 outbox 按连接身份隔离；缓存不是第二套权威历史。

建议的首批 preload 能力：

- 设备凭据读取、写入和删除；
- 选择上传文件；
- 选择下载位置或保存下载；
- 使用系统默认应用打开已确认的本地文件；
- 打开经过校验的外部链接；
- 获取应用版本和平台信息；
- 受限的系统通知与深链事件。

## 7. 历史、同步与发送可靠性

桌面端不得因为 Electron 窗口长期打开而降低既有可靠性要求：

- 首次连接先读取快照，再消费持久增量；两者之间的竞态由现有客户端契约处理。
- 进入 Thread 默认定位最新消息；向上分页保持当前阅读锚点。
- 乐观消息使用稳定 `client_message_id`，与服务端确认按身份合并，不按正文猜测。
- 消息先写入本地持久 outbox，再尝试发送；确认丢失后复用同一 ID 核对或重试。
- 鉴权失败停止盲重试；执行结果为 unknown 时自动核对但不得自动重跑。
- WebSocket 只用于唤醒和低延迟通知，持久同步仍通过服务端游标补齐。
- 系统通知不能代替消息存储。
- 桌面和手机同时在线时，重复或乱序事件不得形成重复消息或使已读位置倒退。

## 8. Markdown、工具与附件

- 桌面消息内容与手机端展示同一份权威正文和工具摘要。
- Markdown、代码、表格、公式和 Mermaid 使用桌面浏览器能力渲染，但保留 CSP、无站外请求和失败显示原文的安全要求。
- Agent 公开说明、工具调用和最终回复按原始顺序展示。
- 工具记录只显示服务端提供的安全名称、标签和受限详情，不显示内部 reasoning、原始参数 JSON、原始工具返回或凭据。
- 附件由服务端授权上传、下载；不能把某台 Mac 的本地路径当成跨端附件身份。
- 文件拖放只是选择上传来源，关闭窗口或换设备后仍从服务端附件记录恢复。

## 9. macOS 平台适配

首轮开发及验收目标设备为已提供的 Apple Silicon Mac mini。最低支持的 macOS 版本在首个打包卡中根据 Electron 基线和实际目标设备确定，不在设计阶段猜测。

需要真实 macOS 验证的能力：

- `.app` 构建、启动、退出和重开；
- Keychain 保存、读取、忘记连接及身份隔离；
- Finder 文件拖放、文件选择、下载和系统打开；
- 系统通知权限、显示及点击定位；
- 菜单、快捷键、窗口尺寸和栏宽恢复；
- Retina 字体、滚动、长历史性能和内存；
- 与 iPhone 同时在线、跨端已读、审批竞态和断网恢复。

Linux 可用于大部分开发、单元测试和 renderer 自动化，但不能替代上述 macOS 真机验收。

## 10. 实施阶段

### D0：安全桌面壳与真实连接

- 建立 `apps/desktop` 的 main/preload/renderer。
- 固定 Electron 安全配置和开发启动方式。
- 接入设备配对及 Keychain。
- 使用现有 `HermesClient` 连接开发 Gateway。
- 三栏显示真实 Channel、Thread 和最近消息。
- 在 Mac mini 构建并启动未签名开发 `.app`。

退出条件：真实 Mac 上可安装或复制启动，完成配对并只读浏览真实数据；不是浏览器页面。

### D1：完整聊天闭环

- 历史最新窗口、向上分页和实时追加。
- 持久 outbox、发送、重试恢复和状态合并。
- Markdown、工具记录、审批、澄清、停止和运行中补充。
- 附件上传、下载、拖放和打开。
- 未读、跨端已读和基本快捷键。

退出条件：可作为日常桌面聊天客户端使用，并与手机端保持一致。

### D2：可靠性与桌面体验

- 断网、切网、Gateway 重启和长时间离线。
- 全部客户端关闭后的任务结果恢复。
- 大量历史的列表性能、内存与锚点。
- 通知深链、窗口恢复和辅助功能。
- 双端审批竞态和同 ID 幂等验证。

退出条件：相关自动测试与 Mac/iPhone 双端实测均有记录；未测项不宣称完成。

### D3：分发准备（以后决定）

- Developer ID 签名和 notarization。
- 安装镜像、升级迁移和自动更新。
- 正式发布渠道、隐私说明和回滚策略。

D3 不阻塞 D0–D2 的内部开发与真实设备验收。

## 11. 第一版验收清单

至少验证：

1. 在真实 Apple Silicon Mac 上启动独立 `.app`，不是浏览器或 PWA。
2. 配对后重启 App，凭据从 Keychain 恢复；忘记连接后不能继续访问。
3. Channel/Thread 创建和编辑与手机端同步。
4. 桌面发送、手机查看，以及手机发送、桌面查看均不重复、不乱序。
5. 接收确认丢失时使用同 ID 重试，只产生一条用户消息和一次执行。
6. 用户上翻时新消息不抢位置；回到最新后继续跟随；加载旧历史保持锚点。
7. Agent 输出、工具记录、系统通知、附件和历史冷读一致。
8. 一端处理审批后另一端及时收起；过期操作不能生效。
9. 一端已读后另一端同步，乱序事件不能使已读位置倒退。
10. 关闭桌面与手机后，已接收任务继续；重开后恢复完整结果。
11. 断网、切网、睡眠/唤醒和 Gateway 重启后自动补齐。
12. Keychain、日志、通知和提交内容不泄露 token 或私人消息数据。

## 12. 第一版不包含

- Windows、Linux 正式桌面支持和验收。
- Developer ID 签名、notarization、App Store 或公开下载。
- 自动更新服务。
- 多窗口和多账号同时在线。
- 托盘常驻、关闭窗口后本地后台驻留和全局快捷键。
- 完整搜索中心、复杂 Thread 分类、社交权限体系。
- 消息编辑、删除、引用或重新执行语义。
- 第二套聊天后端、独立权威消息数据库或 Hermes 核心改动。

## 13. 实现卡中的决策点

以下内容不阻塞设计定稿，已分配到对应实现卡，必须在开工或验收前明确：

- `DESK-D0-01`：Electron、构建器、React 工具链和 workspace 的固定版本及选择依据。
- `DESK-D0-06`：最低 macOS 版本、内部 `.app` 构建、传输和回滚方式。
- `DESK-D0-09`、`DESK-D1-06`：Keychain 库与本地 outbox 存储格式、迁移和清理规则。
- `DESK-D2-04`：renderer 虚拟列表方案、数据集及长历史性能门槛。
- 各卡分别标记自动测试、Mac 真机和 Mac/iPhone 双端证据；总验收卡不得用自动检查替代真实设备项目。
