# 桌面独立标签工作区

桌面使用自建标签栏与独立 `WebContentsView`，不再使用页面栈。手机继续使用原生导航栈。

## 工作区与页面

- 主窗口 renderer 只负责 sidebar、标签栏和工作区浮层，不加载所有 Session 正文。
- 每个 Session tab 使用独立 renderer，固定绑定连接身份与稳定 Thread ID。
- 同一窗口内再次打开同一 Session，会激活已有 tab。
- 切页只切换 View 的可见性。原页面的 DOM、历史窗口、滚动、草稿、附件及工作记录展开状态保持不变。
- 关闭 tab 释放对应 `webContents` 与已提交内容页，不停止服务端任务。关闭当前 tab 后激活相邻页。
- 关闭窗口时显式释放所有子 View，避免后台 renderer 泄漏。
- 本候选不新增跨窗口唯一锁、跨重启 tab 恢复或多连接配对功能。

`DesktopTabManager` 维护 tab 与 IPC sender 的对应关系。所有内容请求从已注册的顶层 `webContents` 获取目标，不信任 renderer 自报的 Thread ID。后台页发送、停止、审批、重试与附件操作不能改用前台 Session。Session 标签编辑也限制在所属 Thread。

## 标签宽度与溢出

标题区最小宽度为 `6em`，按当前字号保留六个汉字宽度，不使用适合拉丁数字宽度的 `ch` 单位。标签整体最小宽度为 `calc(6em + 90px)`，另留内边距、最多三个状态点与关闭按钮的空间；整体最大宽度不小于此下限。标题使用省略号，现有按钮 `title` 保留完整标题及状态提示。

标签栏沿用 `overflow-x: auto`。超过可见空间时横向滚动，不压缩到六个字以下，不撑宽正文区域。未改变 tab 身份、激活、关闭、内容 View 或页面状态。

后续要求：标签栏不显示滚动条（`scrollbar-width: none` 与 `::-webkit-scrollbar`），仍可用触控板横向滚动。没有滚动条后，鼠标纵向滚轮在标签栏上转为横向滚动；激活的 tab 自动滚入可见范围。

候选 `fix/desktop-tab-width`。生产 React/CSS 的 Chromium 回归覆盖 720/1280/1800px 窗口及 12/16/24px 字号、八种状态组合、新建标签、六字下限、标题截断及完整悬停属性、状态点和关闭按钮不重叠、横向滚动两端可达。桌面 TypeScript、构建及全部 41 项测试通过，0 失败、0 跳过；包括受控传输的 Linux Electron/Xvfb 原生工作区测试。未合入、未发布；macOS 真机悬停提示、触控板及视觉验收仍待完成。

## 标签右键菜单

每个 tab 支持右键菜单，键盘 ContextMenu 或 Shift+F10 也可打开。菜单由主进程使用原生 `Menu` 显示，因为 HTML 浮层会被原生内容 View 遮住。只有主窗口 renderer 可以请求此菜单。

- Close Tab：与关闭按钮相同。
- Close Tabs to the Right：关闭标签栏中此 tab 右侧的全部 tab。没有右侧 tab 时禁用。
- Close Other Tabs：只保留此 tab。只有一个 tab 时禁用。

批量关闭沿用单个关闭的规则：释放 View 与已提交内容页，不停止服务端任务。当前激活的 tab 被关闭时，激活菜单所属的 tab。正在执行操作（busy）的 tab 保留，其余 tab 照常关闭，并提示稍后再试。

## Session 内容宽度与输入框

- Session 消息、审批卡片和输入控件使用居中列，最大宽度 768px。滚动区域和输入区背景仍铺满整页。New chat 表单的最大宽度同为 768px。
- 打开或切换到 Session 页面时，焦点进入输入框。隐藏的 tab 不获取焦点。主进程在激活、新建和侧边栏打开 tab 时聚焦对应 View；后台同步不抢焦点。
- 发送期间输入框暂时禁用。发送或粘贴上传完成后，如果之前焦点在输入框，焦点回到输入框。
- 发送键：内容为单行时，Enter 发送。内容含换行时，Enter 换行，Cmd+Enter（其他平台 Ctrl+Enter）发送。Shift+Enter 始终换行。输入法组字时不发送。

## New chat

New chat 打开完整标签页，提供多行正文、附件选择/拖放及 Project 选择。准备正文和选择文件时，不创建空 Session。

第一次提交依次执行：

1. 使用稳定 `clientThreadId` 创建或恢复 Thread。
2. 将所选文件上传至该 Thread，并保存上传记录。
3. 使用稳定 `clientMessageId` 将正文和附件交给本地 durable outbox。
4. 在原 tab ID 和原 View 内显示 Session 页面。

失败时保留正文、文件和 Project。Thread 创建成功后，固定该 Thread，不允许重试改用另一个 Project。部分附件上传失败会清理本轮已上传文件。上传成功、首条消息失败时，重试不重复创建 Thread 或上传附件。首条消息保存成功、页面切换确认失败时，只重试切换，不重发正文。

本地 durable save 是切换为 Session 页的门槛，不等同于服务端已接受。服务端未接受时，Session 页继续显示 outbox 的待处理、未知或失败状态。切换连接期间完成的旧存储请求不能把消息加入新连接的 outbox。

未创建 Thread 的 New chat 正文与 File 对象只保留在活着的 renderer 中。关闭该页或退出应用会丢失这些尚未提交的内容；本候选不新增跨重启的新建页恢复。

## Sidebar 与排序

- 顶部保留 New chat 和轻量筛选图标，取消 Channels 标题、activity nav bar 与独立 Labels 行。
- 每个 Channel/Project 分组直接显示 Session。连接名称是次要归属信息，不增加三级树。
- 未筛选时不展示标签条件行；筛选后显示可移除条件与 Clear。
- 标签浮层提供搜索、多选和 No labels。条件按 OR 匹配，筛选后保留分组。
- 每组按 Running 优先，再按最后消息时间倒序。同时间使用稳定 ID 作为 tie-breaker。
- 所有 Running Session 均展示，不受近 72 小时（2026-10-12 前为 24 小时）及初始 24 条窗口限制。
- 非 Running Session 使用最近活动窗口；筛选时采用全时段目录，并按 24 条逐批 Show more。
- 浮动折叠按钮保持 sidebar 边缘位置，折叠后同步调整原生 View bounds。

## 右侧预览栏宽度

- 预览栏（Browser）左边缘有 6px 拖动条，和左侧 sidebar 一样可拖动改变宽度。向左拖变宽，向右拖变窄。
- 预览页面和对话都是原生 View，会盖住 renderer 元素。所以网页 View 左侧留出 5px，加上 1px 边框，组成没有原生 View 覆盖的拖动条。
- 未拖动过时保持原自动宽度：窗口宽度的 42%，限制在 280–560px。拖动或用键盘调整后，宽度保存在本机 localStorage `hermes.desktop.browser-width`，重新打开时恢复。
- 最小 280px。最大值保证对话区至少 360px，并给可见的左侧 sidebar 留出其最小 200px；预览变宽时左侧 sidebar 暂时收窄，不改变它保存的宽度。窗口变窄时宽度自动收紧。
- 双击拖动条清除保存值，回到自动宽度。拖动条可获得焦点：←/→ 每次 10px，Home 最小，End 最大。保存失败时显示提示，当前宽度仍然生效。
- 验证：`browser-width.test.mjs` 检查宽度规则和存储容错。Electron/Xvfb 原生测试用真实输入拖动生产拖动条，检查拖动条不被两个原生 View 覆盖、原生 View bounds 跟随、保存、冷启动恢复、键盘、上限和双击重置。Xvfb 的真实指针固定在窗口 x=640；拖动捕获期间，原生 View 边缘跨过该点会触发真实移动事件。因此指针拖动保持边缘在 x=640 右侧，更宽的宽度用键盘检查。macOS 实机手感仍待验收。

## 隐藏与浮层

隐藏的 Session 页继续接收所属页面的更新，但不确认已读、不自动聚焦，并静音媒体。前台页面恢复时保留读点。主窗口浮层打开时，暂时隐藏原生内容 View，避免原生 View 遮住 renderer 浮层；关闭浮层后恢复。

文字大小使用现有 localStorage 设置，并通过 `storage` 事件同步至同一工作区中的其他 View。Cmd/Ctrl+N、Cmd/Ctrl+T 打开 New chat；Cmd/Ctrl+W 关闭当前 tab。

## 验证

```bash
npm run desktop:check
HERMES_TEST_CHROME=/usr/bin/google-chrome HERMES_TEST_ELECTRON=1 npm run desktop:check
```

第二条命令启用真实 Chromium 与 Linux Electron/Xvfb 测试。`native-electron.test.mjs` 使用生产主进程路由、preload、renderer 与真实 View；传输和存储采用明确标记的受控 fixture。测试覆盖独立 DOM、完整历史、读点、草稿、隐藏页已读保护、后台发送目标、原 tab 新建、真实文件路径上传、筛选、bounds、浮层、文字大小同步与 View 释放。它不代表真实服务端联调、真实加密存储或 macOS 真机验收。

仍需 macOS 真机检查快捷键、窗口焦点、原生文件选择、附件预览和视觉布局。首次打开延迟、tab 切换延迟与多 renderer 内存需要另行测量；不能据独立 View 结构宣称更省内存。

相关源码：`main/tab-manager.ts`、`main/index.ts`、`renderer/native-workspace.tsx`、`renderer/new-session-page.tsx`。

参考：[Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)、[资源释放](https://www.electronjs.org/docs/latest/api/base-window#resource-management)、[安全规则](https://www.electronjs.org/docs/latest/tutorial/security)。

## Floating Session toolbar candidate

Branch: `feat/desktop-floating-toolbar`; base `origin/main` `0010c74`.

- The Session page has no title bar. The tab already shows the Session title; the Project name is not shown on the page.
- The tools are one row of icon buttons that floats at the top right over the timeline: Copy link, Edit labels (when supported), Rename, Archive, Settings. Each button has an accessible name and a tooltip. Session labels stay at the left end of the row.
- The timeline starts at the top of the page. The old header used 76px; the floating row is 36px high and covers only the top right corner. It has a translucent background so text under it stays readable.
- Error banners stay above the timeline. No change to actions, IPC, drafts, scroll or history.

Verification: `HERMES_TEST_CHROME=/usr/bin/google-chrome HERMES_TEST_ELECTRON=1 xvfb-run -a npm run desktop:check`: 124 passed, 0 skipped. New Chromium test `session-toolbar` checks no header or title/Project text, one row, position, timeline top, labels and button actions. Tests that measured the old header now measure the toolbar. macOS visual acceptance is separate. Not merged or released.

## In-app tooltips and attachment card layout

Branch: `feat/desktop-tooltips-attachment`; base `main` `975357e`. Request: Jamie, 2026-10-08.

- Session toolbar buttons (Copy link, Export conversation, Edit labels, Rename, Archive, Settings) and message attachment actions (Preview, Open externally, Save, View file, large image preview) show a tooltip on hover.
- Native `title` tooltips did not show on the Session page. The page is a `WebContentsView`; that is the likely cause, not confirmed on macOS. The page now draws its own tooltip (`renderer/tooltip.tsx`): controls set `data-tooltip`, and one layer per Session page shows it after 450 ms, below the control (above it at the bottom edge), kept inside the window. Keyboard focus shows it at once. Click, scroll, Escape and window blur hide it. Accessible names stay on `aria-label`.
- Attachment card: the thumbnail is at the left. The file name has its own line, with the size under it. All actions are on one line below, aligned with the name. Only a very narrow window wraps the actions.

Verification: the Chromium test `session-toolbar` checks tooltip text, position and hiding for toolbar buttons, the hide after a click, and the attachment layout (name on one line, actions in one row below it, tooltips present). macOS visual acceptance is separate.

Release v0.1.48 (2026-10-08, authorized by Jamie: "merge and redeploy"): `main` fast-forwarded `975357e..0834e75` and pushed with tag `v0.1.48`. Tag run 37759139816 succeeded. Release `Hermes-0.1.48-macOS-arm64.zip`: checksum OK, Info.plist 0.1.48, arm64 executable; ASAR `dist/main/index.cjs`, `dist/preload/index.cjs`, `dist/renderer/index.js`, `dist/renderer/styles.css` byte-identical to the local build. `desktop:check` under Xvfb before release: 135/136; the failure was the known intermittent `browser-window-native` test, which also failed on unchanged `main` (1 of 2 runs). Desktop-only change: Expo, plugin and Gateway not touched. Previous release for rollback: `v0.1.47`. macOS visual acceptance is still open.

## Inactive tab background

Inactive tabs use `--app-tab-inactive` (`#e9ebee`), slightly darker than the tab strip (`#f3f4f6`). The active tab keeps the page background (`#f9fafb`). The Chromium test `tab-status` checks both computed colors.

Release v0.1.58 (2026-10-09, authorized by Jamie: "合并发布", then "move package building to mac mini"): fix `efc7098`; release commit `6a5567a`, tag `v0.1.58`. Tag `v0.1.57` (`4527171`) exists but was never published: GitHub Actions refused to start its job (account payment problem), and its `mac-control` cancel test fails on the Mac mini every time. v0.1.58 adds the test fix and Mac mini packaging (`scripts/macmini-desktop-release.sh`; see docs/desktop-release-retention.md). Before the tag, the Linux desktop suite had 147 passed, 0 failed, 5 skipped. On the Mac mini, `desktop:check` had 119 passed, 0 failed, 33 skipped; `npm audit` found 0 vulnerabilities. The package was published with `--publish-built`. The downloaded `Hermes-0.1.58-macOS-arm64.zip` passed its SHA-256 check and is byte-identical to the checked package. Info.plist reports 0.1.58, the executable is arm64, and all 29 ASAR `dist/` files are byte-identical to the Linux build. Release pruning kept v0.1.58 and v0.1.56 and deleted v0.1.55. Plugin, mobile, Expo (PID 1962170) and Gateway are unchanged. Real-device acceptance on Jamie's Mac is pending.

## Fixed tab actions

Jamie (2026-10-09): New tab and Browser are two icon buttons fixed at the right end of the tab bar. They do not scroll with the tabs. Their panel is opaque, and the tabs scroll under it.

- Structure: `.desktop-tabbar` holds the scrolling `.desktop-tabs` (the tablist) and `.desktop-tab-actions`, which is absolutely positioned at the right with the tab bar background (`--app-rail`).
- The tab list ends with space as wide as the panel, so the last tab can scroll fully clear of it. `scroll-padding-inline-end` keeps an active tab that is scrolled into view out from under the panel.
- Icons come from the bundled icon font: `plus` (E012) and the new `panelRight` (E015, a window outline with a right panel). Existing glyphs are byte-identical; the unchanged font rebuilds byte for byte before the addition.
- Labels, disabled rules, `aria-expanded`, the ⌘T shortcut and the click behavior are unchanged. Each button has a tooltip.
- Chromium test `tab-status` checks, at three widths and three font sizes: buttons outside the tablist, at the right edge in order, unmoved while tabs scroll; opaque panel on top of a tab under it; last tab clear of the panel at the scroll end; active tab not hidden; icon font glyphs. `sidebar-recents` checks that the E015 glyph loads from the font.

Release v0.1.60 (2026-10-10, authorized by Jamie: "合并发布"): feature `e2aa57f`, release commit `325bca5`, tag `v0.1.60`, built on the Mac mini (122 pass, 0 fail, 33 skipped; `npm audit` 0 vulnerabilities). The downloaded zip matches its `.sha256` and the built file; Info.plist shows 0.1.60; the packaged icon font is byte-identical to `assets/work-icons.ttf`. Release v0.1.58 was pruned; v0.1.59 is kept for rollback. Mobile: `hermes-app-expo.service` restarted (PID 385457 → 452778); iOS and Android manifests report SDK 57.0.0, both launch bundles return HTTP 200, and the served icon font equals the repository font (hash `123afa5a…`). Mac visual check is still open.

## Composer focus when the app becomes active

Requested by Jamie: when the desktop app comes back to the front and the visible tab is a Session page, the cursor goes to that page's composer.

- Main process: the window `focus` event calls `DesktopTabManager.windowFocused()`. If the active tab is a visible Session page, the manager focuses its view and sends `desktop:focus-composer`.
- No change for New chat and Automation tabs, or while a dialog in the main window covers the page (the page view is hidden then).
- Session page (`shell.tsx`): on the signal, the composer takes focus without scrolling the timeline. A dialog open on the page (Edit labels) keeps its focus. If the composer is disabled during a send, focus returns to it when the send ends.
- This also applies when the user last clicked the sidebar or the browser pane before switching to another app.
- Tests: `tests/native-tabs.test.mjs` (which tab is focused and signaled), `tests/window-focus-composer.test.mjs` (Chromium, production Session page: focus from a button and from no focus, reading position unchanged, open dialog kept, hidden tab ignored). Mac acceptance is pending; the macOS window activation itself is not tested on Linux.
