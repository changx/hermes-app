# Channel primary path（客户端）

状态（2026-10-08）：已合并并发布。App main `d5a8913`（桌面 v0.1.51），插件 main `b3799c0`（v0.2.11）。插件已安装到 hermes-app-dev，待 Gateway 重启后生效。

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

## 发布记录（2026-10-08，Jamie 授权「merge and redeploy」）

- 插件：tag `v0.2.11`，归档 sha256 `c60b4123009b591458fe21bea77c8118abae35eea8ff92c6a23c809d73b40553`。只安装文件到 hermes-app-dev；回读 22 个文件，`*.py` 与插件 main 一致。变更模块都在启动时导入，所以运行中的 Gateway 仍使用 v0.2.10，重启后才生效。jamie profile 未改动。
- 手机：main 合入后只重启 `hermes-app-expo.service`（PID 1490287）。lockfile 未变，未执行 npm ci。公网 iOS/Android manifest HTTP 200、SDK 57.0.0；launchAsset HTTP 200，含 `Primary folder`、`channel_primary_path`、`bound_primary_path`。bundle sha256：iOS `7ce0ed4fb979264ad2dac3c5ecd80acc25ad90eb0643f2739f15558aaaba551c`，Android `2d4166bf5b5f7c9daba50b446bba7fa894359939db30f94cadd7aa9a125c7f7a`。
- 桌面：tag `v0.1.51`，CI run `37865708523` 成功并发布 `Hermes-0.1.51-macOS-arm64.zip`。下载后 sha256 校验通过，Info.plist 版本 0.1.51，arm64；ASAR `dist` 与本地验证构建逐字节一致（source map 不打包）。
- 回滚：插件恢复备份目录后重启 Gateway；App 对 `d5a8913`、`703aeb6` 做 git revert 后重启 Expo。不恢复聊天数据。

## 修复：保存后读取确认（2026-10-10）

- 问题：桌面保存 Primary folder 总是提示「The primary folder change could not be confirmed」。重新打开对话框时，文件夹也显示为空。
- 原因：共享 SDK `LiveSessionClient.getChannelInfo` 只返回 `id`、`name` 和 `description`，丢弃了 `bound_primary_path`。桌面 `setProjectFolder` 和手机保存都用这个读取结果确认，所以读到 `null`，判定不一致。服务端实际已经保存。
- 旧的互通测试只用 `HermesClient.listChannels` 读取，没有覆盖 App 使用的 `getChannelInfo`。
- 修复：`getChannelInfo` 返回 `bound_primary_path`（字符串或 `null`；旧服务端不返回时省略），格式错误时报协议错误。新增 `packages/client/tests/channel-info.test.mjs`；`tests/client/primary-path-interop.mjs` 增加 `getChannelInfo` 的绑定和解除读取确认。

## 尚未完成

- 插件安装到 hermes-app-dev 和 Gateway 重启后，验证实际加载的版本、HTTP/WS 行为和一条真实模型消息。
- 手机 Expo 发布和桌面安装包发布需要单独授权。
- iPhone 和 Mac 真机验收。
