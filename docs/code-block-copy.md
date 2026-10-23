# 桌面代码复制

## 需求

- Jamie 报告：桌面 Session 中 Markdown 代码块（包括只有一行的代码块）没有复制功能。v0.1.107 给所有代码块加了右上角复制按钮。
- Jamie 再次报告：单行内容仍没有复制功能，要求单行内容整行点击复制。

## 行为

- 多行代码块：右上角有一个复制按钮（与消息工具栏相同的复制图标），一直显示。按钮放在代码块外层框上，不在横向滚动的 `pre` 内；横向滚动时按钮位置不变。
- 单行代码块（fenced 或缩进代码块，原文只有一行）：不显示按钮；点击整行任何位置（包括右侧空白）都复制该行。
- 行内代码（`` `code` ``）：点击复制该段代码。链接内的行内代码不复制，点击仍打开链接。
- 工具命令行（`.tool-command`，例如终端命令）：点击整行复制显示的命令。
- 可点击复制的元素显示手形光标和悬停底色，提示文字为 `Click to copy`。键盘聚焦后按 Enter 或空格复制。
- 拖选部分文字后松开鼠标不复制，文字仍可正常选择和用系统快捷键复制。
- 复制原文：保留空格、缩进和内部换行，去掉末尾换行。成功显示 `Copied`，失败显示 `Could not copy.`，约 1.4 秒后消失。单行块和命令行的提示在行内右侧，行内代码的提示在其上方。
- Mermaid 图表没有复制功能。
- 桌面 Markdown 文件预览复用同一渲染器，行为相同。

## 实现

- `apps/desktop/src/renderer/click-copy.tsx`：`writeClipboard`、`useCopyNote`、`ClickCopy`（点击/键盘复制，选区保护，`data-copy-note` 提示）和 `InCodeBlock` context。
- `message-content.tsx`：`pre` 从 hast `code` 节点读取原文；单行用 `ClickCopy`（`code-block-line`），多行外包 `.code-block-frame` 并加 `CodeCopy` 按钮。`code` 用 `InCodeBlock` 与 `InLink` context 区分块内代码、链接内代码和行内代码。
- `shell.tsx`：工具命令行改用 `ClickCopy`。
- Session 页面经 `window.hermesDesktop.copyText`（主进程 `clipboard.writeText`）复制。Markdown 预览页没有 app API，改用 `navigator.clipboard.writeText`；预览面板已允许 `clipboard-sanitized-write`。
- 样式在 `styles.css` 的 `.code-block-frame`、`.code-copy`、`.click-copy`。

## 验证

- Chromium 回归 `apps/desktop/tests/code-block-copy.test.mjs`（渲染真实 `DesktopShellView`）：只有多行块有按钮，横向滚动 200px 后按钮不移动；3 个单行块无按钮、`role=button`、手形光标，点击行右端复制；行内代码点击复制，链接内代码不复制；工具命令按 Enter 复制；部分选区点击不复制；复制内容与原文完全相同；成功与失败提示正确；无 app API 时使用 web clipboard。去掉源码改动后此测试失败。
- 单行点击复制改动：`npm run typecheck`、`npm run build` 通过；Linux 全套（Chromium，未下载 Electron）246 个测试，238 通过，0 失败，8 跳过。

## 发布记录

### v0.1.107（多行与单行代码块的右上角按钮）

- 功能提交 `4a0562f`，发布提交 `13260d6`，tag `v0.1.107`。[Release v0.1.107](https://github.com/changx/hermes-app/releases/tag/v0.1.107)。
- Linux 发布树全套：246 个测试，238 通过，0 失败，8 跳过。Mac mini workflow：246 个测试，190 通过，0 失败，56 跳过；audit 0。
- 下载的 `Hermes-0.1.107-macOS-arm64.zip` 通过 SHA-256 sidecar 校验；Info.plist 为 0.1.107；ASAR 中 `dist/` 的 9 个 js/cjs/css 文件与本地构建逐字节相同。未签名、未 notarize。

## 待验收

单行点击复制尚未发布。Mac 真机显示与复制待 Jamie 验收。插件、手机、Expo 和 Gateway 未变化。
