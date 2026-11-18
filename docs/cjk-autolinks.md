# 中文标点前的裸链接（桌面）

## 问题

消息中的裸链接后面紧跟中文标点时，桌面端把标点和后面的中文也放进链接。例如 `用新号登录 https://my.telegram.org，进入 API development tools`，链接变成 `https://my.telegram.org，进入`，点击后打开错误的地址。

## 原因

GFM 的裸链接规则让链接一直延伸到空白字符。它只去掉结尾的 ASCII 标点（`?!.,:*_~`），不认识 `，。、）` 等中文全角标点。中文文本在链接后面通常没有空格。

## 实现

`apps/desktop/src/renderer/cjk-autolinks.ts` 中的 remark 插件 `remarkCjkAutolinks` 只处理裸链接，不改 `<…>` 和 `[文字](地址)` 链接：

- 遇到中文和全角标点（`，。、；：！？（）「」【】“”…—` 等）时结束链接。
- 中文、日文或韩文文字直接接在 ASCII 主机名后面时（`https://my.telegram.org进入`），在主机名处结束链接。
- 路径中的中文保留在链接中（`https://zh.wikipedia.org/wiki/中文`）。
- 截断后再按 GFM 规则去掉结尾的 ASCII 标点。截断的部分作为普通文字显示。

聊天消息、直接回复和 Markdown 文件预览共用这组插件。

测试：`apps/desktop/tests/cjk-autolinks.test.mjs`。不加修复时 4 项中 3 项失败，加入后 4 项通过。

## 手机端

手机端（markdown-it linkify）能处理 `，`，但 `。`、`）` 和直接相连的中文仍被放进链接。本次不改手机端。
