# 纯文本代码块自动换行

## 需求

Jamie 确认：纯文本代码块自动换行；带编程语言的代码块保持原行并横向滚动。

纯文本代码块包括：

- 语言标记为 `text`、`txt`、`plaintext` 或 `plain` 的 fenced 代码块（不区分大小写）。
- 没有语言标记的 fenced 代码块。
- 缩进代码块。

其他语言（例如 `python`、`ts`、`bash`）的代码块不变：保留原行，在代码块内横向滚动。Mermaid 图表不受影响。

适用范围：桌面 Session 页面、桌面 Markdown 文件预览（复用同一渲染器）、手机聊天时间线和手机全屏阅读。

## 实现

- 共享规则 `packages/client/src/codeBlocks.ts` 的 `wrapsCodeLines(language)` 判断是否换行。两端都用它，避免规则不一致。
- 桌面：`message-content.tsx` 的 `pre` 从子 `code` 元素读取语言；纯文本时加 `code-block-wrap`，样式为 `white-space: pre-wrap; overflow-wrap: anywhere`。
- 手机聊天：纯文本代码块不再放进横向 `ScrollView`，文字在代码框宽度内换行。点按复制、长按选择不变。
- 手机全屏阅读：纯文本代码块加 `wrap` class，`pre` 使用 `pre-wrap` 与 `overflow-wrap: anywhere`。

换行保留原有空格、缩进和换行符，只在超出宽度时折行。复制内容与原文相同。

## 验证

- 桌面 Chromium 回归 `code-block-wrap.test.mjs`：520px 与 900px 宽度下，四种纯文本代码块无横向溢出、折成多行、不超出内容栏且保留全文；`python` 代码块仍横向溢出。去掉新样式后此测试失败。
- 手机组件回归：无语言、`text`、`TXT`、`plaintext`、`plain` 无横向滚动器且保留全文；`python`、`bash` 保留一个横向滚动器。
- 手机全屏 HTML 回归：`text`、无语言、缩进代码块为 `code wrap`，`python` 为 `code`，样式规则存在。
- 去掉手机端改动后，两个手机新测试失败。

## 待验收

Mac 与 iPhone 真机显示待验收。未发布桌面安装包，未更新手机测试入口。
