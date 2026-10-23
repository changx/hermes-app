# 桌面代码块复制

## 需求

Jamie 报告：桌面 Session 中 Markdown 代码块（包括只有一行的代码块）没有复制功能。

## 行为

- 每个代码块右上角有一个复制按钮（与消息工具栏相同的复制图标），一直显示。
- 适用于：带语言的 fenced 代码块、无语言或纯文本代码块、单行代码块、缩进代码块。
- 不适用于：行内代码（`` `code` ``）和 Mermaid 图表。
- 点按后复制代码块原文：保留空格、缩进和内部换行，去掉末尾换行。复制成功显示 `Copied`，失败显示 `Could not copy.`，约 1.4 秒后消失。
- 按钮放在代码块外层框上，不在横向滚动的 `pre` 内；长代码横向滚动时按钮位置不变。`pre` 右侧留出按钮宽度，单行代码文字不压在按钮下面。
- 桌面 Markdown 文件预览复用同一渲染器，也显示复制按钮。

## 实现

- `apps/desktop/src/renderer/message-content.tsx`：`pre` 组件外包 `.code-block-frame`，加入 `CodeCopy`。复制文本从 hast `code` 节点读取原文。
- Session 页面经 `window.hermesDesktop.copyText`（主进程 `clipboard.writeText`）复制。Markdown 预览页没有 app API，改用 `navigator.clipboard.writeText`；预览面板已允许 `clipboard-sanitized-write`。
- 样式在 `styles.css` 的 `.code-block-frame`、`.code-copy`、`.code-copy-note`。

## 验证

- Chromium 回归 `apps/desktop/tests/code-block-copy.test.mjs`：4 个代码块各有按钮，行内代码与 Mermaid 没有；按钮距代码块上、右各 8px；单行文字右端在按钮左侧；横向滚动 200px 后按钮不移动；复制内容与原文完全相同；失败提示正确；无 app API 时使用 web clipboard。去掉本改动后此测试失败。
- `code-block-wrap.test.mjs` 仍通过；`npm run typecheck`、`npm run build` 通过。

## 待验收

Mac 真机显示与复制待验收。未发布桌面安装包。
