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

## 5. 桌面端执行

- 每个指令运行一次 `cua-driver call`，参数按“选项在前、位置参数在后”传递，并设置 `CUA_DRIVER_RS_UPDATE_CHECK=false`。
- 截图写到系统临时目录，读出后转成 JPEG（`nativeImage`，质量 80，**不缩放**），然后删除临时文件。驱动返回的 x/y 坐标就是这张截图的像素，缩放会导致点错位置。
- 输出中 2000 字符以上的 base64 串替换为 `[binary data omitted]`。输出上限 120,000 字符。
- 退出码不为 0 时：先运行 `cua-driver status`。守护进程没运行时，用 `open -n -g -a CuaDriver --args serve` 启动它，等 2 秒，然后重试一次（守护进程没运行时，指令还没有执行，所以重试是安全的）。守护进程在运行时，不重试，把驱动的错误原样交给 Agent（例如 `stale_element_token`）。
- 取消（聊天里的停止或服务器的 `cancel`）和超时（90 秒）都会结束驱动进程。
- `mac` 指令不需要会话标签页，不调用 `ensureTab`。

## 6. 已验证事实

| 项目 | 结果 | 依据 |
|---|---|---|
| `cua-driver call` 输出 | JSON 文本写到 stdout，不含图像数据 | 真实驱动 0.34.0（Linux） |
| 截图 | `--screenshot-out-file` 写出 PNG；`get_window_state` 的坐标是这张截图的像素，截图不超过 1.15 百万像素 | 同上，以及驱动返回的 `frame_note` |
| 拒绝执行 | 退出码 1，stdout 是 `{"status":"refused","refusal":{"code":...}}`，stderr 为空 | 同上 |
| 守护进程未运行 | `call` 和 `status` 的退出码都是 1 | 同上 |
| `MacDriver` 端到端 | 自动启动守护进程一次、读取窗口、截图尺寸不变、临时文件删除、拒绝原因原样返回、`describe` 和 `list_tools` 可用 | Xvfb + 真实驱动 |
| Jamie 的 Mac | 驱动已安装在 `~/.local/bin/cua-driver`，守护进程在运行，两个权限均为 true，归属 `com.trycua.driver` | Jamie 提供的 `check_permissions` 输出 |

## 7. 待验证项（macOS 真机）

1. 从 Hermes App 启动的 `cua-driver call` 能正常连接 CuaDriver 守护进程，权限仍归属 `com.trycua.driver`。
2. 守护进程没运行时，`open -n -g -a CuaDriver --args serve` 能把它启动起来。
3. `nativeImage` 能读取驱动写出的 PNG，并转换成 JPEG。
4. 第一版没有“你已接管”检测。Agent 操作期间，用户同时操作同一个 App 可能互相干扰。
5. 默认 `standard` 权限模式下，哪些驱动工具需要额外批准。

## 8. 验收

1. 打包的 macOS 桌面版安装后，在真机上由 Agent 完成一次真实任务：列出 App、读取一个窗口、点击、输入文字。
2. Agent 操作期间，用户的鼠标和当前前台 App 不变。
3. 卸载或移走驱动后重新连接，Agent 得到“需要安装 Cua Driver”的说明，不改用其他工具。

## 9. 实现

| 位置 | 内容 |
|---|---|
| 插件 `plugins/hermes_app/desktop_browser.py` | `desktop_mac` 工具、`mac` 动作、参数校验、错误说明、截图结果 |
| `apps/desktop/src/shared/browser-control.ts` | `MAC_ACTION`，指令解析接受 `mac` |
| `apps/desktop/src/main/mac-control.ts` | 查找驱动、运行 `cua-driver`、截图转换、守护进程自动启动、取消和超时 |
| `apps/desktop/src/main/browser-control.ts` | 按驱动是否存在声明 `mac`；`mac` 指令不打开标签页 |
| `apps/desktop/src/main/index.ts` | 创建 `MacDriver`，用 `nativeImage` 转换截图 |
| 测试 | 桌面 `tests/mac-control.test.mjs`（假驱动）、`tests/browser-control.test.mjs`（控制连接）；插件 `tests/p1/test_desktop_browser.py` |
