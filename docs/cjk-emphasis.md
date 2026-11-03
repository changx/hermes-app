# 中文标点后的加粗（桌面）

## 问题

模型回复常用 `**标题：**正文` 格式，例如 `**每笔收汇都有记录：**国际收支申报数据…`。桌面端把 `**` 原样显示，移动端正常加粗。

## 原因

CommonMark 的 flanking 规则规定：标点后面的结束 `**`，后面必须接空格或标点，才能结束加粗。`：` 是标点，后面的 `国` 是文字，所以这个 `**` 不能结束加粗。

- 移动端（markdown-it）在 `apps/mobile/src/messageMarkdown.ts` 中有 `cjk_strong` 规则：`**` 前后是中文标点时，允许开始或结束加粗。
- 桌面端（`react-markdown` + `remark-gfm`）原来没有对应处理。

## 实现

桌面端 `apps/desktop/src/renderer/message-content.tsx` 的 `remarkPlugins` 加入 `remark-cjk-friendly`（2.3.3，精确版本）。聊天消息、直接回复和 Markdown 文件预览共用这组插件。英文强调仍按标准规则（例如 `snake_case_name`、`2 * 3 * 4` 不变）。

测试：`apps/desktop/tests/cjk-emphasis.test.mjs`。不加修复时 4 项中 3 项失败，加入后 4 项通过。

## 发布记录（2026-11-02）

- 实现提交 `557040b`，快进合入 `main`；release 提交 `2f54a8d`，tag `v0.1.119`。只改桌面 workspace，未重启 Expo、Gateway，插件和 core 不变。
- tag run `41580179018` 用时 7 分 1 秒。测试 265 项：206 通过、0 失败、59 跳过；audit 0。App 与 DMG：Developer ID 签名、staple 验证通过、`source=Notarized Developer ID`；DMG 公证提交 `8b824b20-f907-40a0-bc74-e1774ff703d6` `Accepted`。
- CI 打印的 9 个 app 代码 SHA-256 与本地 `npm run build`（同一 tag）完全一致。Release 资产只有 `Hermes-0.1.119-macOS-arm64.dmg`（147,005,901 bytes）及 `.sha256`，下载后 `sha256sum -c` OK。
- 回滚：桌面安装 v0.1.118。
- 待验收：Jamie 在 Mac（v0.1.119）上打开含 `**…：**正文` 的回复，确认加粗显示。
