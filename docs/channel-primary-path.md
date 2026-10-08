# Channel primary path（客户端）

分支：App `feat/channel-primary-path`，插件 `feat/channel-primary-path`。状态：本地候选，未合并，未发布。

## 已确认需求（Jamie，2026-10-08）

- App 的 project（Channel）接口支持绑定 primary path。
- primary path 只能是服务器上 `/opt/projects` 下的文件夹。
- Agent 的工作目录（cwd）不改变。
- AGENTS.md 跟随 primary path。

服务端契约、路径规则和存储方式见插件仓库 `docs/channel-primary-path.md`。

## 共享 SDK

- `supportsChannelPrimaryPath`：读取 capability `channel_primary_path`。
- `Channel.bound_primary_path`：已绑定的文件夹；未绑定时为 `null`。托管 workspace 不算绑定。
- `createChannel(name, description, primaryPath?)`。
- `updateChannel(id, { primary_path })`：字符串表示绑定，`null` 表示解除绑定，省略表示不改变。

## 手机（Channel Context 页面）

- 服务端支持时，页面顶部显示「Primary folder」：当前文件夹或「Not set」，以及 Set／Change／Remove。
- 保存前客户端去掉末尾斜杠。保存后再读取 Channel 信息，确认服务端结果与输入一致，才关闭编辑框。
- Remove 先请求确认。
- 错误使用普通语言：文件夹不可用（400）、已被其他 Channel 使用（409）、无法确认（其他）。输入内容保留。
- 文件夹编辑与 Context 描述编辑不同时打开。

## 桌面（Project 对话框）

- 服务端支持时，显示「Primary folder」输入框。新建时读取连接 capability，编辑时读取服务端返回。
- AGENTS.md 跟随文件夹，所以两者不在同一次保存中修改：文件夹有改动时 AGENTS.md 编辑框锁定；AGENTS.md 有改动时文件夹输入框锁定。
- 清空文件夹表示解除绑定，保存前请求确认。
- 新建 Project 时先创建，再绑定文件夹。绑定失败时 Project 已存在，表单转为编辑模式并保留输入，与 AGENTS.md 和文件的部分失败处理相同。
- 主进程 `setProjectFolder` 通过读取确认服务端结果。

## 本地验证

- 共享 SDK：`scripts/client-check.sh` 40 passed。
- 手机：TypeScript 检查通过；全部测试 139 passed，1 skipped（含新增 `channel-primary-folder.test.mjs` 5 项）。
- 桌面：`xvfb-run -a npm run desktop:check`（含 Electron 和 Chrome 测试）141 项中 140 passed。失败的 `browser-window-native` 是已知的不稳定测试，单独重跑 3 次都通过，与本改动无关。
- 插件全量 P1（`env -u HERMES_HOME`）：169 passed，1 failed，2 skipped。失败的 `test_runner[midturn]` 单独重跑 3 次都通过，与本改动无关。
- 真实互通：插件测试通过 `HERMES_APP_SDK_ROOT` 运行 `tests/client/primary-path-interop.mjs`，使用共享 SDK 和手机原生 transport，经 loopback HTTP 访问真实插件。绑定、读取、AGENTS.md 来源、拒绝 `/etc`、拒绝重复文件夹和解除绑定都通过。

## 尚未完成

- 插件安装到 hermes-app-dev 和 Gateway 重启后，验证实际加载的版本、HTTP/WS 行为和一条真实模型消息。
- 手机 Expo 发布和桌面安装包发布需要单独授权。
- iPhone 和 Mac 真机验收。
