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
