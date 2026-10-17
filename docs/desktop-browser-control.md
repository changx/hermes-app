# 桌面版内置浏览器：Agent 操作能力

状态：方案已确认（2026-10-07），已实现并通过本地验证，macOS 真机验收待完成。本文区分**已确认需求**、**已验证事实**和**待验证项**。

## 1. 目标

在 Hermes 桌面版里，Agent 可以操作用户可见的内置浏览器（右侧浏览器侧栏），完成需要用户登录状态或需要用户在场的网页任务。用户随时可以接管和打断。整个过程不要求用户处理技术问题。

## 2. 已确认需求

1. **不让网站察觉自动化。** 不使用 CDP（不调用 `webContents.debugger.attach`，不开启远程调试端口，不加 automation 启动参数）。只通过 Electron 原生接口和 IPC 操作页面。
2. **明确区分两类浏览器工具。**
   - Gateway 端：现有的 `browser_*`，服务器上的无头浏览器，界面名称“后台浏览器”。
   - App 端：新增的 `desktop_browser_*`，用户桌面版里的浏览器侧栏，界面名称“你的浏览器”。
   - 两者之间不自动回退。改用后台浏览器前，Agent 先征得用户同意。
3. **App 端浏览器权限和普通 Chrome 一致。** 不在权限问题上逐项开口子。唯一的硬边界：网页不能接触 Hermes App 本身。
4. **用户可以接管和打断。** 用户在页面里点击或打字，Agent 立即暂停。
5. **登录状态按 Channel 隔离。** 同一个 Channel 下的 Thread 共享登录，不同 Channel 之间互不可见。
6. **体验流畅。** 提示使用普通用户能理解的语言，不出现 WebSocket、控制器、令牌等技术词。

## 3. 已验证事实

验证环境：Mac mini，macOS 26.5，arm64，Electron 44.4.5（Chromium 152）。原始结果在 Channel workspace 的 `desktop-browser-probe/`。

| 项目 | 结果 |
|---|---|
| `sendInputEvent` 点击和按键 | 窗口在前台、失焦、另一个 App 在前台、被遮住、最小化、view 隐藏、App 隐藏时都能送达。`isTrusted=true`，不抢焦点 |
| `insertText`（含中文） | 以上所有状态下都能送达 |
| 滚轮 | view 隐藏或窗口最小化时，需要关闭后台节流才能送达 |
| `capturePage` | 所有状态下都返回非空图像。开启节流且 view 不可见时，画面不再更新 |
| `before-mouse-event` / `before-input-event` | 注入的鼠标按下、松开和按键事件**也会触发**这两个事件。`insertText` 和滚轮不会触发 |
| Client Hints | Electron 默认不发送 `Sec-CH-UA` 请求头（与改不改 UA 无关）。补发 3 个默认请求头后，UA、请求头和 `navigator.userAgentData` 一致 |
| UA 覆盖 | 只调用 `session.setUserAgent` 不影响已创建的 view，必须同时调用 `webContents.setUserAgent` |

## 4. 架构

```
Agent（Gateway 进程，hermes-app-dev profile）
  └─ desktop_browser_* 工具（hermes_app 插件注册）
       └─ 插件浏览器桥：按 Thread 选择在线的桌面设备
            └─ WebSocket /v1/desktop-browser（设备凭据认证）
                 └─ 桌面版主进程 BrowserControl
                      └─ 浏览器侧栏 pane（Thread 所在的标签页）
                           ├─ 原生输入：sendInputEvent / insertText
                           ├─ 截图：capturePage
                           └─ 页面读取：隔离 world preload ⇄ IPC
```

- 不修改 Hermes 核心。工具通过插件的 `ctx.register_tool` 注册。截图使用核心已有的多模态工具结果格式（`_multimodal`）。
- 不使用核心的 browser control broker。原因：插件平台的会话不会设置 broker 需要的 `browser_control_principal`。
- 不复用 `/v1/live`。原因：它的客户端上行消息上限是 1024 字节，客户端下行上限是 64 KB，截图结果会超出上限。浏览器控制使用一条单独的 WebSocket。
- 工具通过会话上下文 `HERMES_SESSION_PLATFORM`、`HERMES_SESSION_CHAT_ID`（Channel）和 `HERMES_SESSION_THREAD_ID`（Thread）确定目标。

## 5. 工具（App 端）

| 工具 | 作用 |
|---|---|
| `desktop_browser_navigate(url)` | 打开网址 |
| `desktop_browser_snapshot()` | 读取页面结构，返回带元素 ref 的文本 |
| `desktop_browser_click(ref)` | 点击元素 |
| `desktop_browser_type(ref, text, submit?)` | 在输入框里输入文字，可选按回车提交 |
| `desktop_browser_press(key)` | 按一个键，例如 Enter、Escape、Tab |
| `desktop_browser_scroll(direction)` | 上下滚动约一屏 |
| `desktop_browser_back()` | 后退 |
| `desktop_browser_screenshot(question?)` | 截图，图像直接交给模型查看 |
| `desktop_browser_handoff(message)` | 把页面交给用户处理（登录、验证码、文件选择等），等待用户完成 |

规则：
- 工具只在 hermes_app 会话里有效。在其他平台调用时，返回说明，不执行任何操作。
- 核心对 `check_fn` 的结果做进程级缓存，不能按会话控制工具是否出现。所以工具的 schema 保持稳定，在线状态通过工具结果告诉 Agent。
- 付款、发送消息、删除数据这类不可撤销的操作，Agent 先在聊天里征得用户同意。这条规则写在工具描述里。

## 6. 协议：`GET /v1/desktop-browser`（WebSocket）

认证沿用插件中间件（设备凭据或管理员令牌）。所有帧都是 JSON 文本。

客户端 → 服务器：

| 帧 | 字段 |
|---|---|
| `hello` | `protocol: 1`，`device_name`，`actions: [...]` |
| `bindings` | `threads: [{thread_id, channel_id, active, focused_at}]`，即当前打开的会话标签页 |
| `result` | `id`，`ok`，`result` 或 `error: {code, message}` |

服务器 → 客户端：

| 帧 | 字段 |
|---|---|
| `hello` | `protocol: 1` |
| `command` | `id`，`thread_id`，`channel_id`，`action`，`args`，`timeout_ms`，`open_tab` |
| `cancel` | `id` |

- **设备选择**：优先选择已经打开这个 Thread 标签页的设备，其中选最近活跃的一台。同一个 Thread 在连接期间固定使用同一台设备。没有设备打开这个 Thread 时，选择最近活跃的在线设备，并要求它在后台打开这个对话的标签页（`open_tab: true`），不切换用户当前的标签页。
- **幂等**：每个指令有唯一 `id`，桌面端按 `id` 去重。断线时，正在执行的指令返回“结果不确定”，服务器不重发。Agent 重新读取页面核对结果，不盲目重试。
- **打断**：Agent 的运行被停止时，服务器发送 `cancel`。

## 7. 桌面端执行

- **不使用 CDP，也不使用 DOM 合成事件。** 点击、按键用 `sendInputEvent`，输入文字用 `insertText`，截图用 `capturePage`。
- **页面读取**：浏览器专用 preload 运行在隔离 world，不向页面暴露任何对象。preload 读取 DOM，为可交互元素分配 ref，ref 保存在隔离 world 的 WeakMap 里，不写回 DOM。主进程通过 IPC 请求快照和元素坐标，并检查 IPC 发送方必须是对应的浏览器 pane。
- **点击**：preload 把元素滚动到可见区域，返回元素中心坐标，并检查这个坐标上的元素是不是目标元素或它的子元素。主进程在这个坐标注入鼠标事件。
- **节流**：Agent 正在操作的 pane 关闭后台节流。操作空闲 20 秒后恢复节流。
- **后台尺寸**：浏览器侧栏没有打开时，Agent 操作的 pane 使用不可见的默认尺寸（1024×768），保证页面布局和截图有意义。
- **第一版限制**：只处理主 frame 和同源 iframe。跨域 iframe 里的元素不出现在快照里。

## 8. 权限：和普通 Chrome 一致

- 顶层导航允许 `http`、`https`、`about:blank`，以及附件预览使用的 `hermes-preview`。子资源不再按白名单拦截，只拦截 `file:` 和 `chrome:`（内置 PDF 阅读器需要的资源除外）。
- 带窗口特性的弹出窗口（例如第三方登录）打开为真实的子窗口，使用同一个 session。普通的新标签页链接在当前 pane 里打开。
- 允许下载，文件保存到系统“下载”文件夹，侧栏显示保存结果。
- 摄像头、麦克风、定位、通知等权限显示询问提示，由用户选择。选择在本次运行期间按网站记住。
- 登录状态：`persist:hermes-browser-<账户ID>-<ChannelID>`。不属于任何 Channel 的标签页使用 `persist:hermes-browser-<账户ID>-default`。关闭标签页不清除登录数据。
- 硬边界：浏览器 session 和 App 页面分开；不开 Node，不开 webviewTag；IPC 只接受浏览器 pane 自己的消息；preload 不向页面暴露对象。
- 发送和页面 JS 一致的 3 个 Client Hints 请求头。整体表现为标准 Chromium，不冒充 Google Chrome。

## 9. 接管和打断

侧栏的四个状态：

| 状态 | 用户看到的提示 | Agent 的行为 |
|---|---|---|
| 空闲 | 无 | — |
| Hermes 操作中 | 浮动条：“Hermes 正在使用此页面” · 停止 | 正常执行 |
| 你已接管 | “你已接管，Hermes 已暂停” · 让 Hermes 继续 | 下一个指令等待用户点击“让 Hermes 继续”，最多等 5 分钟。超时后返回说明，由 Agent 在聊天里询问 |
| 等你处理 | Agent 给出的说明，例如“请在此登录” · 好了 | `desktop_browser_handoff` 等待用户点击“好了”，最多等 10 分钟 |

- **触发接管**：用户在页面里按下鼠标或按键。移动鼠标和滚动只算查看，不触发接管。
- **区分用户输入和 Agent 输入**：注入的事件也会触发 `before-*-event`（已验证），所以主进程记录自己注入的每个鼠标按下和按键事件。收到的事件如果不在这份记录里，就是用户的输入。
- **停止按钮**：侧栏上的“停止”立即取消当前指令，状态变为“你已接管”。聊天里的停止会停止整个任务，服务器发送 `cancel`。
- 恢复后，Agent 先重新读取页面，再继续操作。

## 10. 用户提示（示例）

- “请在电脑上打开 Hermes，我才能使用你的浏览器。”
- “你的电脑暂时连不上，请确认 Hermes 正在运行。”
- “你已接管，Hermes 已暂停。”
- “这个频道里还没有登录过这个网站。请在侧栏中登录一次，之后这个频道里的对话都可以使用。”

## 11. 待验证项

1. 跨域 iframe 里的 preload 和点击坐标换算（第一版不支持）。
2. 原生对话框（alert、confirm）和文件选择。第一版交给用户处理，使用“等你处理”状态。
3. 插件工具对同一 profile 的 CLI、cron 也可见。能否通过平台 toolset 配置只对 hermes_app 开放，待确认。
4. UA 和 Client Hints 之外的指纹（`window.chrome`、插件列表等）。

## 12. 验收

1. 打包的 macOS 桌面版安装后，在真机上由 Agent 完成一次真实网页任务：打开网址、读取页面、点击、输入、截图。
2. 用户在操作中点击页面，Agent 暂停；点击“让 Hermes 继续”后恢复。
3. 断开网络再恢复，未完成的指令返回“结果不确定”，不重复执行。
4. 同一个 Channel 的两个 Thread 共享登录；另一个 Channel 看不到这个登录。
5. 桌面版没有运行时，工具返回用户能看懂的提示，不改用后台浏览器。

## 13. 实现（分支 `feat/desktop-browser-control`）

| 位置 | 内容 |
|---|---|
| 插件 `plugins/hermes_app/desktop_browser.py` | 工具注册、`/v1/desktop-browser` 连接、设备选择、幂等、打断（插件仓库，v0.2.6） |
| `apps/desktop/src/shared/browser-control.ts` | 指令解析、按键映射、注入事件记录、Client Hints、导航规则 |
| `apps/desktop/src/preload/browser-page.ts` | 隔离 world 页面读取：快照、元素定位、字段值、滚动位置 |
| `apps/desktop/src/main/browser-sidebar.ts` | 按 Channel 的持久分区、权限询问、下载、弹出窗口、原生输入执行、接管和交还状态 |
| `apps/desktop/src/main/browser-control.ts` | 每个服务器一条控制连接、上报打开的会话、后台打开标签页、取消和断线处理 |
| `apps/desktop/src/renderer/browser-sidebar.tsx` | 状态行：“Hermes 正在使用此页面 · Stop”、“You took over · Let Hermes continue”、交还说明 · Done |

界面文字沿用应用现有的英文界面。

同一通道还承载 Mac 原生 App 控制（`mac` 动作，`desktop_mac` 工具），见 [desktop-mac-control.md](desktop-mac-control.md)；以及本机 MCP server 转发（`mcp` 动作，`desktop_mcp` 工具），见 [desktop-mcp-host.md](desktop-mcp-host.md)。

## 14. 本地验证（2026-10-07）

- 插件：`tests/p1` 完整套件 141 通过、2 跳过；新增 `test_desktop_browser.py` 覆盖认证、往返、重复应答、设备选择、断线不重发、打断、无效帧、工具说明和截图格式。
- 桌面：`HERMES_TEST_CHROME=/usr/bin/google-chrome HERMES_TEST_ELECTRON=1 xvfb-run -a npm test` 133 通过、0 跳过。
  - `browser-control.test.mjs`：真实 WebSocket 服务器上的握手、会话上报、执行、重复 ID 只执行一次、后台标签页、取消、断线中止和重连、旧服务器不频繁重试。
  - `browser-control-native.test.mjs`（真实 Electron/Xvfb）：打开、快照（含同源 iframe）、点击和按键为 `isTrusted`、中文输入和替换、提交表单、后退、滚动、截图 JPEG；读取页面前后 DOM 和全局对象不变；用户按下即接管，下一个指令等待“继续”；侧栏停止和服务器取消；交还和 Done；通知权限询问用户；下载保存；同一 Channel 共享登录、不同 Channel 隔离、关闭页面不清除登录；登录弹窗打开为真实窗口。
- 以上是 Linux/Xvfb 的本地验证，不等于 macOS 真机验收。第 12 节的真机验收待完成。
