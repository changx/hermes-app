# 桌面版本机 MCP server 转发

状态：方案已确认（2026-10-17），已在分支 `feat/desktop-mcp-host`（App 与插件仓库）实现，本地验证通过。尚未合并、发布或做 macOS 真机验收。本文区分**已确认需求**、**设计**和**待验证项**。

## 1. 目标

Agent 在 Gateway 上运行，但可以使用用户 Mac 上的 MCP server。例如 AdsPower Local API 只在本机 `localhost:50325` 监听，Gateway 不能直接访问。Hermes 桌面版在本机启动或连接这些 server，并把工具调用转发给 Agent。

## 2. 已确认需求（Jamie，2026-10-17）

1. **通用能力**：支持任意 MCP server，不只支持某一个 server。
2. **工具暴露方式**：方案 A。Gateway 只注册一个固定工具 `desktop_mcp`，不按 Mac 上报的工具动态注册。
3. **配置入口**：同时支持三种方式：
   - 在设置页中粘贴或编辑 JSON；
   - 直接编辑本机文件；
   - 一键导入 Claude Desktop 的配置。
4. **执行审批**：每个 server 单独设置“直接执行”或“每次在 App 中确认”。
5. **可用范围**：所有 Channel 都可以使用已配置的 server。
6. 不修改 Hermes 核心，不新建协议，复用现有 `/v1/desktop-browser` 通道。

## 3. 为什么只用一个固定工具

- 核心对 `check_fn` 的结果做进程级缓存，不能按会话控制工具是否出现（见 [desktop-browser-control.md](desktop-browser-control.md) §5）。
- 运行时注册的工具不会出现在已有会话里。Mac 下线后，工具仍然存在。插件删除工具还需要额外授权。
- 工具定义一旦变化，prompt cache 就会失效。
- 所以工具定义保持不变。在线状态和 server 列表通过工具结果告诉 Agent。这与 `desktop_mac` 的做法相同。

## 4. 架构

```
Agent（Gateway）
  └─ desktop_mcp 工具（hermes_app 插件，toolset hermes_app_desktop_browser）
       └─ 插件桥：按 server 名称选择在线的桌面设备
            └─ WebSocket /v1/desktop-browser（新增动作 mcp）
                 └─ 桌面版主进程 McpHost
                      ├─ stdio server：本机启动 command/args/env
                      └─ HTTP server：连接 url（Streamable HTTP）
```

## 5. 工具：`desktop_mcp`

参数：`server`（字符串），`tool`（字符串），`arguments`（对象，可选）。

| 调用 | 结果 |
|---|---|
| `tool="list"`，不填 `server` | 列出在线设备和各设备上的 server 名称。插件直接用设备上报的数据回答，不启动任何 server |
| `tool="list"`，填 `server` | 启动这个 server，列出它的工具和第一行说明 |
| `tool="describe"`，`arguments={"tool": "<name>"}` | 返回这个工具的完整说明和参数 schema |
| 其他 `tool` | 调用 server 上的这个工具 |

- 工具描述要求 Agent 在付款、发送消息、删除数据前先在聊天里征得用户同意。这条规则与 `desktop_mac` 相同。
- 文本块和 `structuredContent` 返回给 Agent。图像块转为 JPEG，作为多模态结果交给模型（最多 4 张）。`isError` 作为错误返回。
- 输出上限 120,000 字符。2000 字符以上的 base64 串替换为 `[binary data omitted]`。
- 第一版只支持 tools，不支持 resources、prompts、sampling 和 elicitation。

## 6. 协议扩展（`/v1/desktop-browser`，protocol 仍为 1）

- 桌面版在 `hello.actions` 中声明 `mcp`。旧插件不认识这个动作，会忽略它。
- 桌面版在 `bindings` 帧中增加字段 `mcp_servers: ["name", ...]`（最多 64 个），只列出已启用的 server。旧插件会忽略这个字段。配置变化时，桌面版重新发送 `bindings`。
- 服务器发送 `command`，`action: "mcp"`，`args: {server, tool, arguments}`。旧桌面版不声明 `mcp`，所以不会收到这个动作。
- 设备选择：只选择上报了这个 server 的在线设备。其中优先选择打开了当前 Thread 的设备，然后选最近活跃的设备。`mcp` 动作不打开对话标签页。
- 幂等、断线和取消沿用现有规则：每个指令有唯一 `id`，桌面版按 `id` 去重；断线时结果为“不确定”，服务器不重发；Agent 停止时服务器发送 `cancel`。
- 超时：工具执行最多 180 秒。等待用户确认的时间另算，最多 5 分钟。

## 7. 桌面端

### 7.1 配置文件

- 位置：`<userData>/mcp.json`。在 macOS 上是 `~/Library/Application Support/Hermes/mcp.json`（实际目录名以 App 的 userData 为准，设置页显示完整路径）。
- 格式与 Claude Desktop 相同，另加两个可选字段：

```json
{
  "mcpServers": {
    "adspower-local-api": {
      "command": "npx",
      "args": ["-y", "local-api-mcp-typescript"],
      "env": { "PORT": "50325", "API_KEY": "..." },
      "approval": "ask"
    },
    "local-http": { "url": "http://127.0.0.1:8931/mcp", "headers": {}, "approval": "auto", "disabled": true }
  }
}
```

- `approval`：`ask`（默认，每次在 App 中确认）或 `auto`（直接执行）。
- `disabled: true`：保留配置，但不提供给 Agent。
- server 名称只能使用字母、数字、`_` 和 `-`，最长 64 个字符。
- 有 `command` 的是 stdio server；有 `url` 的是 HTTP server。两者不能同时出现。
- 配置文件只保存在本机。`env` 和 `headers` 中的值不发送到 Gateway，也不出现在设置页以外的界面。
- 桌面版监视这个文件。文件被外部修改后，桌面版重新读取，停止配置已变化的 server，并重新上报 server 列表。文件格式错误时，保留上一次有效的配置，设置页显示错误。

### 7.2 设置页（This device → MCP servers）

- 显示配置文件路径和 JSON 编辑框。保存前校验格式，错误时不写入文件。
- 每个 server 一行：名称、类型、状态（未启动 / 运行中 / 启动失败）、审批方式选择。修改审批方式会写回配置文件。
- “Import from Claude Desktop”：读取 `~/Library/Application Support/Claude/claude_desktop_config.json`，只添加名称不重复的 server，不覆盖已有配置。导入的 server 默认 `approval: "ask"`。
- “Show in Finder”：在 Finder 中显示配置文件。

### 7.3 运行

- 按需启动：第一次调用时启动 server，空闲 10 分钟后关闭，退出 App 时关闭。server 停止后，下一次调用重新启动它。
- stdio：沿用 `desktop_mac` 已验证的按行 JSON-RPC 会话。server 发来的请求中，`ping` 回复空结果，其他请求回复“不支持”（-32601）。
- HTTP：Streamable HTTP。POST JSON-RPC，响应为 `application/json` 或 `text/event-stream`。保存 `Mcp-Session-Id`，关闭时发送 DELETE。不支持旧的 HTTP+SSE 传输。
- **PATH**：从 Finder 启动的 App 没有终端里的 PATH，所以找不到 `npx`、`uvx`。桌面版第一次启动 stdio server 前，用登录 shell 读取 PATH（`$SHELL -ilc`，10 秒超时），并补上 `/opt/homebrew/bin` 和 `/usr/local/bin`。
- 取消：Agent 停止时，桌面版向 server 发送 `notifications/cancelled`。
- 不使用官方 `@modelcontextprotocol/sdk`。原因：它带入 express、hono 等服务端依赖；桌面端只需要客户端的一小部分，现有 stdio 会话已经过验证。

### 7.4 审批

- `approval: "ask"` 的 server，每次调用工具前，桌面版显示系统对话框：
  - 标题：`Allow Hermes to use <tool> from <server>?`
  - 内容：参数摘要（最多 600 字符）。
  - 按钮：`Allow`、`Deny`。
  - 复选框：`Allow all <server> tools until Hermes quits`。
- 对话框显示时，Dock 图标跳动提醒。
- 用户拒绝时，Agent 收到“用户拒绝了这次操作”，不重试。5 分钟内没有回答时，Agent 收到“用户没有确认”，在聊天里询问用户。
- `list` 和 `describe` 只读取工具信息，不需要确认。
- Agent 停止时，对话框自动关闭。

## 8. 已知限制

- cron 任务不能使用 `desktop_mcp`。cron 在独立的 worker 进程中运行，那里没有桌面连接。这与 `desktop_mac` 相同。
- Mac 上的 Hermes 必须打开。App 关闭时，工具返回提示，Agent 不改用其他工具。
- 手机端不提供这个功能。
- 多台 Mac 配置了同名 server 时，按第 6 节的规则只选一台。

## 9. 待验证项（macOS 真机）

1. 从 Finder 启动的 App 能用登录 shell 的 PATH 启动 `npx` server。
2. AdsPower Local API MCP：列出工具、调用一个只读工具。
3. 审批对话框在 App 后台、窗口最小化时都能看到并操作。
4. 修改配置文件后，Agent 立即看到新的 server 列表。

## 10. 验收

1. 打包的 macOS 桌面版安装后，在真机上配置 AdsPower MCP，Agent 完成 `list`、`describe` 和一次真实调用。
2. `approval: "ask"` 时，拒绝后 Agent 不重试；勾选“until Hermes quits”后不再询问。
3. 断网再恢复，未完成的调用返回“结果不确定”，不重复执行。
4. App 关闭时，Agent 收到用户能看懂的提示。

## 11. 实现

| 位置 | 内容 |
|---|---|
| 插件 `plugins/hermes_app/desktop_browser.py` | `desktop_mcp` 工具、`mcp` 动作、按 server 选择设备、`mcp_servers` 解析、错误说明（插件仓库，v0.2.41） |
| 插件 `plugins/hermes_app/tool_timeline.py` | 时间线标题 `Mac MCP · <server> · <tool>`，不显示参数 |
| `apps/desktop/src/shared/mcp-config.ts` | 配置解析与校验、修改审批方式、从 Claude Desktop 导入 |
| `apps/desktop/src/main/mcp-session.ts` | stdio 会话（`desktop_mac` 共用）和 Streamable HTTP 会话；回复 server 的 `ping` |
| `apps/desktop/src/main/mcp-host.ts` | 按需启动、空闲关闭、配置变化时重启、登录 shell 的 PATH、审批、结果转换 |
| `apps/desktop/src/main/browser-control.ts` | 声明 `mcp`、在 `bindings` 中上报 `mcp_servers`、执行 `mcp` 指令 |
| `apps/desktop/src/main/index.ts` | 审批对话框、设置页 IPC（加入 Settings 白名单） |
| `apps/desktop/src/renderer/mcp-settings.tsx` | 设置页 This device → MCP servers |

## 12. 本地验证（2026-10-17，Linux）

- 插件：`test_desktop_browser.py`、`test_tool_timeline.py`、`test_skills_index.py` 共 19 项通过。完整 P1 套件 280 通过、7 跳过、6 失败。其中 5 项在未修改的 `main` 上同样失败（`*_runner` 子进程测试）；另 1 项单独重跑两次均通过。
  - 注意：测试必须使用隔离的 `HERMES_HOME`。否则 `profile_settings` 会读取开发 profile 的真实 `.env` 令牌，认证类测试全部失败。
- 桌面：`HERMES_TEST_CHROME=/usr/bin/google-chrome HERMES_TEST_ELECTRON=1 xvfb-run -a npm test` 236 项中 235 通过。唯一失败的 `browser-window-native` 在负载下超时（110 秒），单独重跑通过；它不涉及 MCP 代码。
  - `mcp-host.test.mjs`（新增）：配置校验与错误说明；修改审批方式时保留其他字段；导入只添加新名称；stdio server 使用登录 PATH 和 `env`、分页列出工具、`describe`、调用、`structuredContent`、图像、`isError`、回复 server 的 `ping`；审批的允许、拒绝、超时、本次运行内全部允许，以及改回 Ask 后失效；配置变化只重启变化的 server；无效文件保留上次有效配置；命令不存在和启动失败时给出说明；超时、取消和空闲关闭；Streamable HTTP 的 JSON 与 SSE 响应、会话 ID、请求头、DELETE 和 404。
  - `browser-control.test.mjs`：`hello` 声明 `mcp`；`bindings` 上报和更新 `mcp_servers`；`mcp` 指令不打开标签页。
  - `mcp-settings.test.mjs`（Chromium）：列表与状态、审批切换、无效 JSON 保留草稿、轮询不覆盖草稿、保存、导入、在 Finder 中显示。
- 真实 server：在本机用新的 stdio 客户端启动 `npx -y local-api-mcp-typescript`（AdsPower Local API MCP），3.2 秒内完成初始化并列出 47 个工具；`describe open-browser` 返回参数；`approval: "ask"` 时拒绝返回 `denied`。本机没有 AdsPower，所以没有执行真实调用。
- 未覆盖：系统审批对话框和设置页 IPC 在真实 Electron 中的行为、macOS 登录 shell PATH。这些属于第 9 节的真机验收。
