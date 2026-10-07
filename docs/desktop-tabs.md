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

候选 `fix/desktop-tab-width`。生产 React/CSS 的 Chromium 回归覆盖 720/1280/1800px 窗口及 12/16/24px 字号、八种状态组合、新建标签、六字下限、标题截断及完整悬停属性、状态点和关闭按钮不重叠、横向滚动两端可达。桌面 TypeScript、构建及全部 41 项测试通过，0 失败、0 跳过；包括受控传输的 Linux Electron/Xvfb 原生工作区测试。未合入、未发布；macOS 真机悬停提示、触控板及视觉验收仍待完成。

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
- 所有 Running Session 均展示，不受近 24 小时及初始 24 条窗口限制。
- 非 Running Session 使用最近活动窗口；筛选时采用全时段目录，并按 24 条逐批 Show more。
- 浮动折叠按钮保持 sidebar 边缘位置，折叠后同步调整原生 View bounds。

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
