# 消息换行与原生命令直接回复排版

## 已确认需求

Jamie 在 Hermes App 中发送 `/commands` 后反馈输出难读（2026-11-01）：

- 桌面端：整页命令连成一大段，命令从行中间开始。
- 手机端：每条命令虽然各占一行，但条目之间没有间距，长参数和描述挤在一起。

Jamie 确认的范围：

- 不改 Hermes core，只改 Hermes App（或 App 插件）。
- 采用通用方案，不识别 `/commands` 或任何特定命令的文本格式。

## 原因

`/commands` 由 core 的 `hermes_cli/slash_exec.py::_exec_commands` 生成：每条命令一行，行与行之间只有单个 `\n`，`format="markdown"`。插件按原文保存为 `display_kind: "direct"` 的直接回复，文本中的换行完整保留。

- 桌面端：`react-markdown` 把单个换行（softbreak）输出为文本 `\n`；`.message-markdown` 的 `white-space: normal` 把它合并成空格，所以整页连成一段。
- 手机端：`messageMarkdown.ts` 已把 softbreak 渲染为换行，所以每条各占一行；但这些行在同一个段落内，行间只有正常行高，没有条目间距。

两端对 softbreak 的处理不一致。Telegram、Discord 等聊天平台把单个换行显示为换行，core 的命令输出也按此编写。

## 方案

1. **桌面端聊天消息的单个换行显示为换行。** 与手机端现有规则一致，对所有聊天消息生效（包括普通模型回复）。Markdown 文件预览（`document`）保持标准 Markdown 规则：源文件中的折行不换行。
2. **所有直接回复（`display_kind === "direct"`）按行分段。** 段落中的每一行成为独立段落，行与行之间使用正常段落间距（桌面约 0.55em，手机 8pt）。只依据 `display_kind` 判断，不解析文本内容。适用于全部原生命令回复，例如 `/commands`、`/help`、`/status`、`/usage`。
3. 原文不变。复制、搜索、同步与存储仍使用服务端原文。代码块、表格、列表、引用的结构不变；只拆分顶层段落中的换行。

## 不做

- 不改 core 命令输出格式，不改插件存储的文本。
- 不为 `/commands` 等特定命令写专用渲染。命令名与描述之间的层级（例如命令一行、描述一行）不在此范围。
- 行内代码跨行时背景按行分段显示，属于行内样式的正常表现，不另行处理。

## 实现位置

- 桌面：`apps/desktop/src/renderer/line-breaks.ts`（remark 插件：文本中的 `\n` 转为换行节点；直接回复再按换行拆分段落），`message-content.tsx` 增加 `lines` 选项，`shell.tsx` 对直接回复传入。
- 手机：`apps/mobile/src/messageMarkdown.ts` 的 `parseMessageMarkdown(text, { lines })` 拆分顶层段落；`MessageContent` 增加 `lines` 属性，`ChatTimeline.tsx` 对直接回复传入。全屏阅读复用同一解析结果。

## 验收

- 桌面：普通消息中的单个换行渲染为 `<br>`；文件预览不变；直接回复中每行渲染为独立 `<p>`。
- 手机：直接回复的解析结果中每行是独立段落；普通消息解析结果不变。
- 用实际 `/commands` 输出文本做渲染测试；客户端现有测试和 TypeScript 检查通过。
- 真机视觉验收另行记录，不以单元测试代替。

## 发布记录（2026-11-01）

- 实现提交 `96bef57`（PR #1），快进合入 `main`。回滚分支 `rollback/direct-reply-layout-before-440298e`（已推送）。
- 手机：只重启 `hermes-app-expo.service`（PID 3565508 → 3629198），开发 Gateway、插件和 core 不变。`/status` 为 `packager-status:running`；公网 iOS / Android manifest 均 HTTP 200，各自 launchAsset 均 HTTP 200（iOS 12,853,852 bytes，Android 12,944,906 bytes），两个 bundle 都包含 `lines: row.displayKind === 'direct'`。
- 桌面 v0.1.117（tag，release 提交 `c9f82b0`）：tag run `41402261718` 在 `npm audit` 停止。新公布的 GHSA-g3hv-75wg-m249（minimatch <11.0.1）和 GHSA-3g3m-2fjr-6pw4（glob ≤14.0.1）经 `@electron/packager → @electron/asar 4.3.1` 引入，均为构建依赖；没有生成 Release。按 Jamie 决定保留该 tag，改发 v0.1.118。
- 依赖修复 `2b39f3c`：根 `package.json` overrides `glob 14.0.3`、`minimatch 11.0.4`。npm 11 在已有 lockfile 的 workspaces 项目中不应用新增 override，所以 lockfile 中 `glob`、`minimatch`、`path-scurry`、`@isaacs/nonrecursive-glob-match` 四项取自同 override 的干净解析，其余条目不变。`npm ci` 通过，`npm audit` 0。`npm ls` 显示 `invalid` 是 npm 对 override 的已知显示问题。Linux 无签名打包前后 `app.asar` SHA-256 相同（`e5b07289…33c9`），36 个文件哈希相同。上游 `@electron/asar` 依赖修复版本后删除这两项 override。
- 桌面 v0.1.118（release 提交 `0dfe541`）：tag run `41403904271` 用时 6 分 33 秒。测试 261 项：202 通过、0 失败、59 跳过；audit 0。App 与 DMG：Developer ID 签名、hardened runtime、staple 验证通过、`source=Notarized Developer ID`；DMG 公证提交 `8fd7260f-b81d-48a2-8d2d-3cc199eaa688` `Accepted`。
- CI 打印的 9 个 app 代码 SHA-256 与本地 `npm run build`（同一提交）完全一致。Release 资产只有 `Hermes-0.1.118-macOS-arm64.dmg`（146,945,159 bytes）及 `.sha256`，下载后 `sha256sum -c` OK。保留的上一版为 v0.1.116。
- 回滚：手机切回回滚分支后重启 Expo；桌面安装 v0.1.116。
- 待验收：Jamie 在桌面（v0.1.118）和手机（Expo Go 重新加载）上发送 `/commands`，确认显示效果。
