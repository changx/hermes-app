# 中文标点前的裸链接（桌面与手机）

## 问题

消息中的裸链接后面紧跟中文标点时，桌面端把标点和后面的中文也放进链接。例如 `用新号登录 https://my.telegram.org，进入 API development tools`，链接变成 `https://my.telegram.org，进入`，点击后打开错误的地址。

## 原因

GFM 的裸链接规则让链接一直延伸到空白字符。它只去掉结尾的 ASCII 标点（`?!.,:*_~`），不认识 `，。、）` 等中文全角标点。中文文本在链接后面通常没有空格。

## 实现

截断规则在共享函数 `packages/client/src/bareLinks.ts`（`trimBareLink`）中，桌面和手机使用同一函数。它只处理裸链接，不改 `<…>` 和 `[文字](地址)` 链接：

- 遇到中文和全角标点（`，。、；：！？（）「」【】“”…—` 等）时结束链接。
- 中文、日文或韩文文字直接接在 ASCII 主机名后面时（`https://my.telegram.org进入`），在主机名处结束链接。
- 路径中的中文保留在链接中（`https://zh.wikipedia.org/wiki/中文`）。
- 截断后再按 GFM 规则去掉结尾的 ASCII 标点。截断的部分作为普通文字显示。

- 桌面：`apps/desktop/src/renderer/cjk-autolinks.ts` 中的 remark 插件 `remarkCjkAutolinks`。聊天消息、直接回复和 Markdown 文件预览共用这组插件。测试 `apps/desktop/tests/cjk-autolinks.test.mjs`：不加修复时 4 项中 3 项失败，加入后 4 项通过。
- 手机：`apps/mobile/src/messageMarkdown.ts` 中 `linkify` 之后的 core 规则 `cjk_linkify`。linkify-it 原来能处理 `，`，但把 `。`、`）` 和直接相连的中文放进链接。测试 `apps/mobile/tests/cjk-autolinks.test.mjs`：不加修复时 3 项中 2 项失败，加入后 3 项通过。

## 发布记录（2026-11-18）

- 实现提交 `62d229a`，合并提交 `5b6b5af`；release 提交 `e401b34`，tag `v0.1.145`。只改桌面 workspace，未重启 Expo、Gateway，插件和 core 不变。
- Mac mini 构建（`scripts/macmini-desktop-release.sh v0.1.145`）：测试 329 项，265 通过、0 失败；audit 0。公证 `529345d7-f088-41ae-a209-9b073e8d4884` `Accepted`，`source=Notarized Developer ID`。
- Release 资产：`Hermes-0.1.145-macOS-arm64.dmg`（147,063,111 bytes）及 `.sha256`。更新 zip 134,271,400 bytes，SHA-256 `7d04d0a6…37beb4`；feed 对 0.1.144 返回 200 并指向 0.1.145，对 0.1.145 返回 204。
- 回滚：发布更高版本（客户端不降级）。
- 待验收：Jamie 在 Mac（v0.1.145）上打开含 `https://my.telegram.org，进入` 的消息，确认链接只到 `.org`。

## 手机发布记录（2026-11-18，Jamie 授权「合并发布」）

- 实现提交 `4e5eb68`，合并提交 `d8b8efc`。共享函数也替换了桌面的同一规则，桌面行为不变；桌面下次发布时带上，本次不发桌面版。
- 候选检查：手机新测试 3/3（不加修复 1/3）；手机全套 277 项，274 通过、1 跳过，2 项失败（`attachment-size`、`local-draft-storage`，缺少 Linux esbuild 二进制，未改动的 `main` 同样失败）。手机 `tsc` 通过。桌面 `cjk-autolinks`、`cjk-emphasis` 通过，`typecheck` 通过，全套结果与 `main` 相同。iOS、Android `expo export --no-bytecode` 通过，两个 bundle 都含 `cjk_linkify`。
- lockfile 未变，未运行 `npm ci`。只重启 `hermes-app-expo.service`（PID 2952299 → 3649280）。iOS、Android manifest 返回 200，SDK 58.0.0；两个 launchAsset 返回 200，且含 `cjk_linkify`。Gateway（`hermes-gateway.service` PID 3441422）和插件不变。
- TestFlight 更新 `4cc63529-44d5-4bf3-bc19-bbc6792edd35`（runtime `b32a4b59…`，git `d8b8efc`）已发布。公开更新 manifest 对上一更新 `c24c8c91…` 返回 200 并提供新 id；bundle 返回 200，含 `cjk_linkify`。
- 回滚：`publish.mjs rollback --platform ios --runtime b32a4b59c09764da6bb60618bb3513d46fe43d86 --to c24c8c91-3009-4e26-a42f-d1b141ebd9a3`；Expo Go 入口用 Git revert 后重启 Expo。
- 待验收：Jamie 在 iPhone 上冷启动两次（第一次下载、第二次运行更新），打开含 `https://my.telegram.org，进入` 和 `https://example.com。然后` 的消息，确认链接只到 URL 本身。
