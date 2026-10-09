# 桌面版：Agent 操作 Mac 上的原生 App

状态：已实现（2026-10-08），已通过 Linux 本地测试，并用真实 Cua Driver（Linux 版 0.34.0）做了端到端检查。macOS 真机验收待完成。本文区分**已确认需求**、**已验证事实**和**待验证项**。

## 1. 目标

Agent 通过用户 Mac 上的 Hermes 桌面版，操作这台 Mac 上的原生 App（Finder、邮件、备忘录、系统设置等）。操作在后台进行，不移动用户的鼠标，也不抢焦点。

## 2. 已确认需求

1. **执行路径是 Hermes App 桌面版。** 不使用 Gateway 端的 `computer_use`（它只能操作 Gateway 主机自己的屏幕），不另装本地 Hermes，也不另接 MCP 服务器。
2. **复用已有的“你的浏览器”控制通道**（`/v1/desktop-browser`，见 [desktop-browser-control.md](desktop-browser-control.md)）：设备选择、指令去重、断线处理和取消都沿用，不新建协议。
3. **最小实现。** 不内嵌驱动，不做签名和 TCC 授权工作，第一版不加新界面。
4. 不修改 Hermes 核心。

## 3. 架构

```
Agent（Gateway，hermes-app-dev profile）
  └─ desktop_mac(tool, arguments)（hermes_app 插件注册，工具集 hermes_app_desktop_browser）
       └─ 插件浏览器桥：action = "mac"，只发给声明了 mac 的桌面设备，不打开会话标签页
            └─ WebSocket /v1/desktop-browser
                 └─ 桌面版主进程 MacDriver（apps/desktop/src/main/mac-control.ts）
                      └─ cua-driver call --screenshot-out-file <临时文件> <tool> <JSON>
                           └─ CuaDriver.app 守护进程（持有“辅助功能”和“屏幕录制”权限）
```

- 用户自己安装 `CuaDriver.app`，并给它授予“辅助功能”和“屏幕录制”权限。Hermes App 本身不需要这两个权限。
- 桌面版只在 macOS 上、并且找到驱动程序时，才在 `hello.actions` 里声明 `mac`。查找顺序：`~/.local/bin/cua-driver`、`/Applications/CuaDriver.app/Contents/MacOS/cua-driver`、`~/Applications/CuaDriver.app/...`、`/opt/homebrew/bin/cua-driver`、`/usr/local/bin/cua-driver`。每次建立连接时重新检查。
- 旧版桌面不声明 `mac`，服务器不会把 `mac` 指令发给它。旧版插件不认识 `mac`，会忽略这个声明。

## 4. 工具

`desktop_mac(tool, arguments)`：执行一个 Cua Driver 工具。

- `tool`：驱动工具名，例如 `list_apps`、`list_windows`、`get_window_state`、`click`、`type_text`、`press_key`、`hotkey`、`scroll`、`set_value`、`launch_app`。
- 两个特殊值：`list_tools` 列出全部驱动工具（`cua-driver list-tools`）；`describe` 加 `{"tool": "<名称>"}` 返回该工具的完整参数（`cua-driver describe`）。
- 只传递驱动工具名和 JSON 参数，所以驱动新增工具时，插件和桌面版都不用改。
- 结果：驱动的 JSON 输出原样返回。有截图时，用多模态格式把图像交给模型，并注明截图尺寸。
- 工具描述写明规则：这是用户的真实电脑；付款、购买、发送消息、发帖、删除数据或修改系统设置前，先在聊天里征得用户同意。

## 5. 桌面端执行（v0.1.53 起）

- 桌面版在一次运行期间保持**一个常驻的 `cua-driver mcp` 会话**（stdio，按行分隔的 JSON-RPC：`initialize` → `notifications/initialized` → `tools/call`）。第一次使用时启动，空闲 10 分钟后关闭，退出 App 时关闭。
- 原因：驱动的窗口快照只在同一个会话里有效。`click`、`type_text` 等操作使用的 `element_token` 或 x/y 坐标，必须来自同一会话中最近一次 `get_window_state`。v0.1.52 每次操作都启动一个新的 `cua-driver call` 进程，所以在真机上只能读，不能点击（驱动返回 `stale_element_token` 或 `screenshot_context_missing`）。
- 在 macOS 上，`cua-driver mcp` 代理到 CuaDriver.app 守护进程，并在需要时启动它，所以桌面版不再自己启动守护进程。
- 返回给 Agent 的文字：驱动的 `structuredContent`（含 `snapshot_id` 和 `element_token`）；没有时用文字块。驱动拒绝执行（`isError`）时，把这段内容原样作为错误交给 Agent。
- 截图：驱动在结果中返回 PNG 图像块。桌面版用 `nativeImage.createFromBuffer` 转成 JPEG（质量 80，**不缩放**）。驱动的 x/y 坐标就是这张截图的像素，缩放会导致点错位置。
- 输出中 2000 字符以上的 base64 串替换为 `[binary data omitted]`。输出上限 120,000 字符。
- `list_tools` 和 `describe` 读取会话的 `tools/list`。
- 取消：向驱动发送 `notifications/cancelled`，会话保留。超时（90 秒）或驱动进程退出：结果为“不确定”，会话立即关闭，下一次操作启动新会话。
- `mac` 指令不需要会话标签页，不调用 `ensureTab`。

## 6. 已验证事实

| 项目 | 结果 | 依据 |
|---|---|---|
| 快照范围 | 快照只在同一会话内有效：单次 `call` 进程之间不能“先读后点” | Jamie 的 Mac（v0.1.52）：读取成功，点击被拒绝 |
| `cua-driver mcp` | 协议 `2025-06-18`；`get_window_state` 返回文字块 + `image/png` 图像块 + `structuredContent`；拒绝时 `isError: true` 和 `structuredContent.refusal` | 真实驱动 0.34.0（Linux，Xvfb） |
| 截图 | 不超过 1.15 百万像素；x/y 坐标是截图像素 | 同上，以及驱动返回的 `frame_note` |
| `MacDriver` 端到端（v0.1.53） | 同一会话中：列出窗口 → 读取窗口（截图尺寸不变）→ 像素点击成功 → 输入文字成功；`list_tools`、`describe` 可用；结束后没有残留进程 | Xvfb + 真实驱动 |
| v0.1.52 在 Jamie 的 Mac 上 | 从 Hermes App 调用驱动正常；`list_windows` 和 `get_window_state`（含截图，1568×1066）成功 | 2026-10-08 真机 |
| Jamie 的 Mac | 驱动在 `~/.local/bin/cua-driver`，守护进程在运行，两个权限均为 true，归属 `com.trycua.driver` | Jamie 提供的 `check_permissions` 输出 |

## 7. 待验证项（macOS 真机）

1. v0.1.53：在真机上读取后点击、输入文字。
2. `cua-driver mcp` 在守护进程没运行时能自动启动它。
3. 第一版没有“你已接管”检测。Agent 操作期间，用户同时操作同一个 App 可能互相干扰。
4. 默认 `standard` 权限模式下，哪些驱动工具需要额外批准。

## 8. 验收

1. 打包的 macOS 桌面版安装后，在真机上由 Agent 完成一次真实任务：列出 App、读取一个窗口、点击、输入文字。
2. Agent 操作期间，用户的鼠标和当前前台 App 不变。
3. 卸载或移走驱动后重新连接，Agent 得到“需要安装 Cua Driver”的说明，不改用其他工具。

## 9. 实现

| 位置 | 内容 |
|---|---|
| 插件 `plugins/hermes_app/desktop_browser.py` | `desktop_mac` 工具、`mac` 动作、参数校验、错误说明、截图结果 |
| `apps/desktop/src/shared/browser-control.ts` | `MAC_ACTION`，指令解析接受 `mac` |
| `apps/desktop/src/main/mac-control.ts` | 查找驱动、常驻 `cua-driver mcp` 会话、截图转换、取消和超时 |
| `apps/desktop/src/main/browser-control.ts` | 按驱动是否存在声明 `mac`；`mac` 指令不打开标签页 |
| `apps/desktop/src/main/index.ts` | 创建 `MacDriver`，用 `nativeImage` 转换截图 |
| 测试 | 桌面 `tests/mac-control.test.mjs`（假驱动）、`tests/browser-control.test.mjs`（控制连接）；插件 `tests/p1/test_desktop_browser.py` |

## 10. 发布结果（2026-10-08）

- Jamie 授权：插件安装到 hermes-app-dev 和 jamie；桌面版“合并代码打包”。
- 插件 v0.2.12（`changx/hermes-app-plugin` 本地 `main` `0b5dd69`，未推送）。安装包 `hermes-app-plugin-0.2.12-b21139e6….tar.gz` 安装到 hermes-app-dev（21:34）和 jamie（22:04，从 v0.2.10 升级，同时带上 v0.2.11 的 Channel 主目录）。Gateway 22:03:31 重启（PID 1894908）后，hermes-app-dev 运行新代码；jamie 的安装晚于这次重启，`/v1/capabilities` 仍没有 `channel_primary_path`，需要再重启一次才生效。
- 桌面版：`origin/main` `a914ef9..20935e2`，标签 `v0.1.52`。打包任务 37887064797 成功。发布文件 `Hermes-0.1.52-macOS-arm64.zip`：校验和正确，ZIP 完整，Info.plist 0.1.52，arm64 可执行文件；ASAR 中 `dist/main/index.cjs`、`dist/preload/index.cjs`、`dist/renderer/index.js`、`dist/renderer/styles.css` 与本地验证的构建逐字节相同。没有手机端改动，Expo 和运行目录未动。
- 证据：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/20261008-213422-desktop-mac/`、`…/20261008-220441-desktop-mac-jamie/`。
- 回滚：插件用证据目录中的 `backup-hermes-app-<版本>` 换回后重启 Gateway；桌面版重新安装 v0.1.51。
- 待完成：jamie 的 Gateway 重启；第 7、8 节的 macOS 真机验收。

## 11. v0.1.53（2026-10-08）：常驻驱动会话

- 真机测试 v0.1.52：读取窗口成功，点击被驱动拒绝（快照不跨进程）。修复见第 5 节。插件不变（v0.2.12）。
- 检查：`desktop:check`（Chrome + Electron）149/149；Xvfb + 真实驱动 0.34.0：同一会话中读取窗口后像素点击、输入文字成功。
- 发布：`origin/main` `a9f0b3f..8bac06a`，标签 `v0.1.53`，打包任务 37892183847 成功。`Hermes-0.1.53-macOS-arm64.zip`：校验和正确，ZIP 完整，Info.plist 0.1.53，arm64；ASAR 四个构建文件与本地构建逐字节相同。Expo 和运行目录未动（只有桌面改动）。
- 回滚：重新安装 v0.1.52（只能读，不能点击）。
- 待完成：真机上读取后点击、输入文字。
